#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

interface WorkspaceEntry {
	path: string;
	name: string;
	lastSeen: number;
}

interface WorkspacesFile {
	version: number;
	workspaces: WorkspaceEntry[];
}

interface MountSpec {
	src: string;
	dest: string;
}

const RUN_CONTAINER = process.env.CCFLARE_CONTAINER || "ccflare-dev";
const SCAN_CONTAINER = `${RUN_CONTAINER}-scan`;
const IMAGE = process.env.CCFLARE_IMAGE || "ccflare:latest";
const PORT = process.env.PORT || "8080";
const DATA_VOLUME = process.env.CCFLARE_DATA_VOLUME || "ccflare-data";
const WORKSPACES_VOLUME =
	process.env.CCFLARE_WORKSPACES_VOLUME || "ccflare-workspaces";
const MAX_DEPTH = process.env.AGENT_SCAN_MAX_DEPTH || "8";
const BASE_SCAN_MOUNTS = detectScanMounts();
const SCAN_ROOTS = BASE_SCAN_MOUNTS.map((m) => m.dest);

if (BASE_SCAN_MOUNTS.length === 0) {
	console.error(
		"No scan mounts available. Provide AGENT_SCAN_ROOTS or ensure / and /mnt/ drives exist.",
	);
	process.exit(1);
}

async function main() {
	logSection("Ensuring volumes");
	runDocker(["volume", "create", DATA_VOLUME], { allowFailure: true });
	runDocker(["volume", "create", WORKSPACES_VOLUME], { allowFailure: true });

	logSection("Stopping existing containers");
	stopContainer(RUN_CONTAINER);
	stopContainer(SCAN_CONTAINER);

	logSection("Starting temporary scanner container");
	const scanRunArgs = [
		"run",
		"-d",
		"--name",
		SCAN_CONTAINER,
		"-e",
		"PORT=8080",
		"-v",
		`${DATA_VOLUME}:/data`,
		"-v",
		`${WORKSPACES_VOLUME}:/root/.ccflare`,
		...flattenMounts(BASE_SCAN_MOUNTS),
		IMAGE,
		"sh",
		"-c",
		"sleep infinity",
	];
	runDocker(scanRunArgs);

	logSection("Running agent scan");
	const scanCmd = [
		"exec",
		"-e",
		"ccflare_DEBUG=1",
		SCAN_CONTAINER,
		"bun",
		"run",
		"agents:scan",
		"--max-depth",
		MAX_DEPTH,
		...SCAN_ROOTS,
	];
	const scanResult = runDocker(scanCmd, { capture: true });
	process.stdout.write(scanResult.stdout || "");
	process.stderr.write(scanResult.stderr || "");

	logSection("Reading discovered workspaces");
	const workspacesRaw = runDocker(
		["exec", SCAN_CONTAINER, "cat", "/root/.ccflare/workspaces.json"],
		{ capture: true, allowFailure: true },
	);

	const workspaceData = parseWorkspaces(workspacesRaw.stdout || "");
	if (!workspaceData.workspaces.length) {
		console.warn("No workspaces discovered. Keeping wide mounts.");
	}

	logSection("Stopping scanner container");
	stopContainer(SCAN_CONTAINER);

	logSection("Building mount plan");
	const specificMounts = buildWorkspaceMounts(workspaceData.workspaces);

	const finalMounts = specificMounts.length
		? specificMounts
		: BASE_SCAN_MOUNTS; // fallback

	logSection(
		`Starting ${RUN_CONTAINER} with ${finalMounts.length} workspace mount${
			finalMounts.length === 1 ? "" : "s"
		}`,
	);
	const runArgs = [
		"run",
		"-d",
		"--name",
		RUN_CONTAINER,
		"-p",
		`${PORT}:${PORT}`,
		"-e",
		`PORT=${PORT}`,
		"-v",
		`${DATA_VOLUME}:/data`,
		"-v",
		`${WORKSPACES_VOLUME}:/root/.ccflare`,
		...flattenMounts(finalMounts),
		IMAGE,
	];
	runDocker(runArgs);

	logSection("Done");
}

function detectScanMounts(): MountSpec[] {
	const mounts: MountSpec[] = [];
	if (existsSync("/")) {
		mounts.push({ src: "/", dest: "/host" });
	}

	const extraRootsEnv = process.env.AGENT_SCAN_ROOTS;
	if (extraRootsEnv) {
		for (const raw of extraRootsEnv.split(/[,;\n\r]+/)) {
			const trimmed = raw.trim();
			if (trimmed && existsSync(trimmed)) {
				mounts.push({ src: trimmed, dest: trimmed });
			}
		}
	}

	const potential = ["/mnt/c", "/mnt/d", "/mnt/e", "/mnt/f", "/mnt/g"];
	for (const path of potential) {
		if (existsSync(path)) {
			mounts.push({ src: path, dest: path });
		}
	}
	return dedupeMounts(mounts);
}

function dedupeMounts(mounts: MountSpec[]): MountSpec[] {
	const seen = new Map<string, MountSpec>();
	for (const mount of mounts) {
		const key = `${mount.src}:${mount.dest}`;
		if (!seen.has(key)) {
			seen.set(key, mount);
		}
	}
	return Array.from(seen.values());
}

function flattenMounts(mounts: MountSpec[]): string[] {
	const args: string[] = [];
	for (const mount of mounts) {
		args.push("-v", `${mount.src}:${mount.dest}`);
	}
	return args;
}

function parseWorkspaces(raw: string): WorkspacesFile {
	if (!raw?.trim()) {
		return { version: 1, workspaces: [] };
	}
	try {
		const data = JSON.parse(raw) as WorkspacesFile;
		return data;
	} catch (error) {
		console.warn("Failed to parse workspaces file", error);
		return { version: 1, workspaces: [] };
	}
}

function buildWorkspaceMounts(workspaces: WorkspaceEntry[]): MountSpec[] {
	const mounts = new Map<string, MountSpec>();
	for (const workspace of workspaces) {
		const mapping = mapWorkspacePath(workspace.path);
		if (!mapping) continue;
		if (!existsSync(mapping.src)) {
			console.warn(`Skipping missing host path ${mapping.src}`);
			continue;
		}
		const key = `${mapping.src}::${mapping.dest}`;
		if (!mounts.has(key)) {
			mounts.set(key, mapping);
		}
	}
	return Array.from(mounts.values());
}

function mapWorkspacePath(containerPath: string): MountSpec | null {
	if (containerPath === "/host") {
		return { src: "/", dest: "/host" };
	}
	if (containerPath.startsWith("/host/")) {
		const src = containerPath.replace(/^\/host/, "");
		const hostPath = src || "/";
		return { src: hostPath, dest: containerPath };
	}
	return { src: containerPath, dest: containerPath };
}

interface RunOptions {
	allowFailure?: boolean;
	capture?: boolean;
	timeoutMs?: number;
}

function runDocker(args: string[], options: RunOptions = {}) {
	const result = spawnSync("docker", args, {
		encoding: "utf-8",
		timeout: options.timeoutMs,
		stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
	});
	if (result.status !== 0 && !options.allowFailure) {
		console.error(`docker ${args.join(" ")} failed`);
		if (options.capture) {
			console.error(result.stderr);
		}
		process.exit(result.status ?? 1);
	}
	return result;
}

function stopContainer(name: string) {
	if (!name) return;
	runDocker(["stop", name], { allowFailure: true });
	runDocker(["rm", name], { allowFailure: true });
}

function logSection(message: string) {
	console.log(`\n=== ${message} ===`);
}

await main();
