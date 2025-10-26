#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Logger } from "@ccflare/logger";
import { agentRegistry } from "../discovery";

interface ScanOptions {
	roots: string[];
	maxDepth: number;
}

interface QueueEntry {
	dir: string;
	depth: number;
}

const log = new Logger("AgentWorkspaceScanner");
const DEFAULT_MAX_DEPTH = Number(process.env.AGENT_SCAN_MAX_DEPTH ?? 8);
const isWindows = process.platform === "win32";

const SKIP_DIR_NAMES = new Set(
	[
		"node_modules",
		".git",
		".hg",
		".svn",
		".cache",
		".ccflare",
		".config",
		".vscode",
		".idea",
		".Trash",
		"__pycache__",
		"venv",
		".venv",
		"Library",
		"System Volume Information",
		"$Recycle.Bin",
		"ProgramData",
		"Program Files",
		"Program Files (x86)",
	].map((name) => name.toLowerCase()),
);

const SKIP_ABSOLUTE_PREFIXES = [
	"/proc",
	"/sys",
	"/dev",
	"/run",
	"/var/lib/docker",
	"/var/lib/containerd",
	"/var/lib/snapd",
	"/var/log",
];

function splitRootsInput(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(/[,;\n\r]+/)
		.map((root) => root.trim())
		.filter(Boolean);
}

function normalizeInputPath(rawPath: string): string {
	const trimmed = rawPath.trim();
	if (!trimmed) return "";

	const windowsDrivePattern = /^([a-zA-Z]):(?:[\\/](.*))?$/;
	const match = trimmed.match(windowsDrivePattern);
	if (match && !isWindows) {
		const drive = match[1].toLowerCase();
		const rest = match[2]?.replace(/\\/g, "/").replace(/^\//, "") ?? "";
		return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
	}

	return trimmed;
}

function collectWindowsDriveRoots(): string[] {
	const roots = new Set<string>();
	const driveLetters = "cdefghijklmnopqrstuvwxyz";
	for (const letter of driveLetters) {
		const candidate = `${letter.toUpperCase()}:\\`;
		if (existsSync(candidate)) {
			roots.add(candidate);
		}
	}
	if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
		const home = `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`;
		if (existsSync(home)) {
			roots.add(home);
		}
	}
	if (process.env.USERPROFILE && existsSync(process.env.USERPROFILE)) {
		roots.add(process.env.USERPROFILE);
	}
	return Array.from(roots);
}

function parseArgs(): ScanOptions {
	const args = process.argv.slice(2);
	const roots: string[] = [];
	let maxDepth = DEFAULT_MAX_DEPTH;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--max-depth" && args[i + 1]) {
			maxDepth = Number(args[i + 1]) || DEFAULT_MAX_DEPTH;
			i++;
			continue;
		}

		if (arg.startsWith("--max-depth=")) {
			const [, depthValue] = arg.split("=");
			maxDepth = Number(depthValue) || DEFAULT_MAX_DEPTH;
			continue;
		}

		roots.push(normalizeInputPath(arg));
	}

	const envRoots = splitRootsInput(process.env.AGENT_SCAN_ROOTS).map((root) =>
		normalizeInputPath(root),
	);

	const extraRoots = splitRootsInput(process.env.AGENT_SCAN_EXTRA_ROOTS).map(
		(root) => normalizeInputPath(root),
	);

	const baseRoots =
		roots.length > 0
			? roots
			: envRoots.length > 0
				? envRoots
				: getDefaultRoots();

	const combinedRoots = [...baseRoots, ...extraRoots].filter(Boolean);
	const resolvedRoots = Array.from(
		new Set(
			combinedRoots
				.map((root) => normalizeInputPath(root))
				.map((root) => resolve(root)),
		),
	);

	if (resolvedRoots.length === 0) {
		resolvedRoots.push(homedir());
	}

	return { roots: resolvedRoots, maxDepth };
}

function getDefaultRoots(): string[] {
	const defaults = new Set<string>();
	const cwd = process.cwd();
	if (cwd) defaults.add(cwd);
	defaults.add(homedir());

	if (isWindows) {
		for (const drive of collectWindowsDriveRoots()) {
			defaults.add(drive);
		}
	} else {
		const linuxCandidates = new Set<string>([
			"/workspaces",
			"/workspace",
			"/workdir",
			"/host",
			"/host_mnt",
			"/data",
			"/opt",
		]);

		const driveLetters = "cdefghijklmnopqrstuvwxyz";
		for (const letter of driveLetters) {
			linuxCandidates.add(`/mnt/${letter}`);
			linuxCandidates.add(`/host_mnt/${letter}`);
		}

		for (const candidate of linuxCandidates) {
			if (existsSync(candidate)) {
				defaults.add(candidate);
			}
		}
	}

	if (
		process.env.AGENT_SCAN_INCLUDE_ROOT === "true" &&
		!isWindows &&
		existsSync("/")
	) {
		defaults.add("/");
	}

	return Array.from(defaults);
}

function shouldSkipAbsolute(path: string): boolean {
	if (path === "/") return false;
	return SKIP_ABSOLUTE_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);
}

function shouldSkipName(name: string): boolean {
	return SKIP_DIR_NAMES.has(name.toLowerCase());
}

async function discoverWorkspaces(
	roots: string[],
	maxDepth: number,
): Promise<string[]> {
	const found = new Set<string>();
	const visited = new Set<string>();
	const queue: QueueEntry[] = [];

	for (const root of roots) {
		if (!existsSync(root)) {
			log.warn(`Skipping missing root ${root}`);
			continue;
		}
		queue.push({ dir: resolve(root), depth: 0 });
	}

	while (queue.length > 0) {
		const current = queue.pop();
		if (!current) break;
		const dir = resolve(current.dir);
		const depth = current.depth;

		if (visited.has(dir)) continue;
		visited.add(dir);

		if (shouldSkipAbsolute(dir)) continue;
		if (depth > maxDepth) continue;

		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			log.debug(`Cannot read ${dir}: ${String(error)}`);
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.isSymbolicLink()) {
				continue;
			}

			const entryPath = join(dir, entry.name);

			if (entry.name === ".claude") {
				const agentsPath = join(entryPath, "agents");
				try {
					const stats = await stat(agentsPath);
					if (stats.isDirectory()) {
						const workspacePath = resolve(dir);
						found.add(workspacePath);
						log.info(`Found agents directory at ${agentsPath}`);
					}
				} catch (error) {
					log.debug(
						`Failed to inspect potential agents directory ${agentsPath}: ${String(error)}`,
					);
				}
				// Always skip descending into `.claude` directories to avoid extra work
				continue;
			}

			if (shouldSkipName(entry.name)) {
				continue;
			}

			queue.push({ dir: entryPath, depth: depth + 1 });
		}
	}

	return Array.from(found);
}

async function main() {
	const { roots, maxDepth } = parseArgs();
	log.info(
		`Scanning ${roots.length} root${roots.length === 1 ? "" : "s"} up to depth ${maxDepth}`,
	);

	const workspaces = await discoverWorkspaces(roots, maxDepth);

	if (workspaces.length === 0) {
		log.info("No .claude/agents directories found.");
		return;
	}

	log.info(
		`Discovered ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}.`,
	);
	const result = await agentRegistry.registerWorkspacesBulk(workspaces);
	log.info(
		`Registered ${result.added} new workspace${
			result.added === 1 ? "" : "s"
		} (updated ${result.updated}, skipped ${result.skipped}).`,
	);

	const registered = agentRegistry.getWorkspaces();
	log.info(`Total registered workspaces: ${registered.length}`);
}

main().catch((error) => {
	log.error("Agent workspace scan failed", error);
	process.exitCode = 1;
});
