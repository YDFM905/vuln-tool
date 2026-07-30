import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

type ToolFactory = (name: string, config: {
	description: string;
	parameters: unknown;
	handler: (args: any) => Promise<unknown>;
}) => unknown;

interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

interface PackageJsonLike {
	overrides?: Record<string, string>;
	[key: string]: unknown;
}

async function runNpmCommand(repositoryPath: string, args: string[], signal?: AbortSignal): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		const child = spawn(command, args, {
			cwd: repositoryPath,
			shell: process.platform === 'win32',
			signal,
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on('error', reject);
		child.on('close', (exitCode) => {
			resolve({
				stdout,
				stderr,
				exitCode: exitCode ?? -1,
			});
		});
	});
}

function parseJsonSafe(raw: string): unknown {
	if (!raw.trim()) {
		return {};
	}

	try {
		return JSON.parse(raw);
	} catch {
		return { raw };
	}
}

async function readPackageJson(repositoryPath: string): Promise<PackageJsonLike> {
	const packageJsonPath = join(repositoryPath, 'package.json');
	const fileContents = await readFile(packageJsonPath, 'utf8');
	return JSON.parse(fileContents) as PackageJsonLike;
}

async function writePackageJson(repositoryPath: string, packageJson: PackageJsonLike): Promise<void> {
	const packageJsonPath = join(repositoryPath, 'package.json');
	await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

export async function createNpmRemediationTools(repositoryPath: string, signal?: AbortSignal): Promise<unknown[]> {
	const sdk = await import('@github/copilot-sdk');
	const defineTool = sdk.defineTool as ToolFactory;

	const runNpmAuditFixJson = defineTool('run_npm_audit_fix_json', {
		description: 'Runs npm audit fix --json in the target repository and returns parsed output.',
		parameters: {
			type: 'object',
			properties: {},
		},
		handler: async () => {
			const commandResult = await runNpmCommand(repositoryPath, ['audit', 'fix', '--json'], signal);
			return {
				exitCode: commandResult.exitCode,
				stdout: commandResult.stdout,
				stderr: commandResult.stderr,
				parsed: parseJsonSafe(commandResult.stdout),
			};
		},
	});

	const npmViewVersions = defineTool('npm_view_versions', {
		description: 'Returns available versions for a package using npm view <package> versions --json.',
		parameters: {
			type: 'object',
			properties: {
				packageName: {
					type: 'string',
					description: 'npm package name to query',
				},
			},
			required: ['packageName'],
		},
		handler: async (args: { packageName: string }) => {
			const commandResult = await runNpmCommand(
				repositoryPath,
				['view', args.packageName, 'versions', '--json'],
				signal,
			);

			return {
				packageName: args.packageName,
				exitCode: commandResult.exitCode,
				stdout: commandResult.stdout,
				stderr: commandResult.stderr,
				versions: parseJsonSafe(commandResult.stdout),
			};
		},
	});

	const readPackageJsonTool = defineTool('read_package_json', {
		description: 'Reads package.json and returns current dependencies and overrides.',
		parameters: {
			type: 'object',
			properties: {},
		},
		handler: async () => {
			const packageJson = await readPackageJson(repositoryPath);
			return {
				overrides: packageJson.overrides ?? {},
				dependencies: packageJson.dependencies ?? {},
				devDependencies: packageJson.devDependencies ?? {},
			};
		},
	});

	const applyOverridesTool = defineTool('apply_overrides_to_package_json', {
		description: 'Merges provided override entries into package.json overrides and writes the file.',
		parameters: {
			type: 'object',
			properties: {
				overrides: {
					type: 'object',
					description: 'Map of package names to target versions.',
					additionalProperties: { type: 'string' },
				},
			},
			required: ['overrides'],
		},
		handler: async (args: { overrides: Record<string, string> }) => {
			const packageJson = await readPackageJson(repositoryPath);
			const mergedOverrides: Record<string, string> = {
				...(packageJson.overrides ?? {}),
				...args.overrides,
			};

			packageJson.overrides = mergedOverrides;
			await writePackageJson(repositoryPath, packageJson);

			return {
				appliedOverrides: args.overrides,
				mergedOverrideCount: Object.keys(mergedOverrides).length,
			};
		},
	});

	const runDependencySafetyCheck = defineTool('run_dependency_safety_check', {
		description: 'Temporarily applies candidate overrides, runs dry-run install and npm ls peer checks, then restores package.json.',
		parameters: {
			type: 'object',
			properties: {
				overrides: {
					type: 'object',
					description: 'Candidate override entries for compatibility validation.',
					additionalProperties: { type: 'string' },
				},
			},
			required: ['overrides'],
		},
		handler: async (args: { overrides: Record<string, string> }) => {
			const packageJsonPath = join(repositoryPath, 'package.json');
			const originalRaw = await readFile(packageJsonPath, 'utf8');
			const originalPackageJson = JSON.parse(originalRaw) as PackageJsonLike;
			const mergedOverrides: Record<string, string> = {
				...(originalPackageJson.overrides ?? {}),
				...args.overrides,
			};

			const candidatePackageJson: PackageJsonLike = {
				...originalPackageJson,
				overrides: mergedOverrides,
			};

			try {
				await writePackageJson(repositoryPath, candidatePackageJson);

				const installResult = await runNpmCommand(
					repositoryPath,
					['install', '--package-lock-only', '--ignore-scripts'],
					signal,
				);

				const lsResult = await runNpmCommand(repositoryPath, ['ls', '--all', '--json'], signal);

				return {
					compatible: installResult.exitCode === 0 && lsResult.exitCode === 0,
					installExitCode: installResult.exitCode,
					installStdout: installResult.stdout,
					installStderr: installResult.stderr,
					lsExitCode: lsResult.exitCode,
					lsStdout: lsResult.stdout,
					lsStderr: lsResult.stderr,
				};
			} finally {
				await writeFile(packageJsonPath, originalRaw, 'utf8');
			}
		},
	});

	return [
		runNpmAuditFixJson,
		npmViewVersions,
		readPackageJsonTool,
		applyOverridesTool,
		runDependencySafetyCheck,
	];
}