#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
type TailwindPlugin = (typeof import("bun-plugin-tailwind")) extends {
        default: infer PluginType;
}
        ? PluginType
        : never;

const tailwindPlugin = await import("bun-plugin-tailwind").then<
        TailwindPlugin | undefined
>(
        (module) => module.default,
        (error: unknown) => {
                if (error instanceof Error) {
                        console.warn(
                                `⚠️  Failed to load bun-plugin-tailwind: ${error.message}. Continuing without Tailwind processing.`,
                        );
                } else {
                        console.warn(
                                "⚠️  Failed to load bun-plugin-tailwind due to an unknown error. Continuing without Tailwind processing.",
                        );
                }
                return undefined;
        },
);

console.log("\n🚀 Building dashboard...\n");

const outdir = path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
	console.log(`🗑️ Cleaning previous build at ${outdir}`);
	await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

const entrypoints = ["src/index.html"];
console.log(`📄 Building dashboard from ${entrypoints[0]}\n`);

const plugins: TailwindPlugin[] = [];

if (tailwindPlugin) {
        plugins.push(tailwindPlugin);
}

const result = await Bun.build({
        entrypoints,
        outdir,
        plugins,
	minify: true,
	target: "browser",
	sourcemap: "linked",
	splitting: true,
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
});

// Generate manifest.json with asset mappings
const manifest: Record<string, string> = {};
for (const output of result.outputs) {
	const relativePath = path.relative(outdir, output.path);
	const publicPath = `/${relativePath}`;
	manifest[publicPath] = publicPath;
}

await writeFile(
	path.join(outdir, "manifest.json"),
	JSON.stringify(manifest, null, 2),
);

const end = performance.now();
const buildTime = (end - start).toFixed(2);

console.log(`✅ Dashboard build completed in ${buildTime}ms\n`);
console.log(`📦 Output files:`);
result.outputs.forEach((output) => {
	console.log(`   - ${path.relative(process.cwd(), output.path)}`);
});
