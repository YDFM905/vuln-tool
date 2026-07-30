const esbuild = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * Copies agent markdown definitions from src/agents to dist/agents so the
 * runtime loader can discover them alongside the bundled extension code.
 * @type {import('esbuild').Plugin}
 */
const copyAgentMarkdownPlugin = {
	name: 'copy-agent-markdown',

	setup(build) {
		build.onEnd(async () => {
			const sourceDir = path.join(__dirname, 'src', 'agents');
			const targetDir = path.join(__dirname, 'dist', 'agents');
			try {
				const entries = await fs.readdir(sourceDir, { withFileTypes: true });
				await fs.mkdir(targetDir, { recursive: true });
				await Promise.all(
					entries
						.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
						.map((entry) =>
							fs.copyFile(
								path.join(sourceDir, entry.name),
								path.join(targetDir, entry.name),
							),
						),
				);
			} catch (err) {
				console.error(`✘ [ERROR] Failed to copy agent markdown files: ${err.message}`);
			}
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: [
			'vscode',
			'@github/copilot-sdk',
			'@github/copilot-*' // this wildcard catches win32-x64, darwin-arm64, etc.
		],
		logLevel: 'silent',
		plugins: [
			copyAgentMarkdownPlugin,
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
