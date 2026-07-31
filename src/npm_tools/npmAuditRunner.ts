import { spawn } from 'child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface NpmAuditResult {
    vulnerabilityDetail: unknown,
    vulnerabilityCounts: unknown,
    rawOutput: string,
    exitCode: number
}

interface SpawnResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

function spawnNpm(repositoryPath: string, args: string[], signal?: AbortSignal): Promise<SpawnResult> {
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

        if (signal) {
            signal.addEventListener('abort', () => {
                child.kill();
            }, { once: true });
        }

        child.on('close', (exitCode) => {
            resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
        });
    });
}

export async function runNpmAudit(repositoryPath: string, signal?: AbortSignal): Promise<NpmAuditResult> {
    const result = await spawnNpm(repositoryPath, ['audit', '--json'], signal);
    const parsedOutput = result.stdout ? safeParseJson(result.stdout) : {};
    return {
        vulnerabilityDetail: (parsedOutput as any)?.vulnerabilities ?? [],
        vulnerabilityCounts: (parsedOutput as any)?.metadata?.vulnerabilities ?? {},
        rawOutput: result.stdout,
        exitCode: result.exitCode,
    };
}

export interface NpmAuditFixResult {
    rawOutput: string;
    exitCode: number;
}

export async function runNpmAuditFix(repositoryPath: string, signal?: AbortSignal): Promise<NpmAuditFixResult> {
    // `npm audit fix` exits non-zero when it cannot fix everything; that is expected here.
    const result = await spawnNpm(repositoryPath, ['audit', 'fix', '--json'], signal);
    return { rawOutput: result.stdout, exitCode: result.exitCode };
}

export interface NpmLsNode {
    version?: string;
    dependencies?: Record<string, NpmLsNode>;
}

export interface NpmLsRoot extends NpmLsNode {
    name?: string;
}

export async function runNpmLs(repositoryPath: string, signal?: AbortSignal): Promise<NpmLsRoot> {
    // `npm ls` exits non-zero when the tree has issues (missing peers, extraneous, etc.);
    // we still get useful JSON on stdout in those cases.
    const result = await spawnNpm(repositoryPath, ['ls', '--all', '--json'], signal);
    if (!result.stdout.trim()) {
        return {};
    }
    const parsed = safeParseJson(result.stdout);
    return (parsed && typeof parsed === 'object' ? parsed : {}) as NpmLsRoot;
}

export interface DependencyMap {
    directDeps: Set<string>;
    parentsByPackage: Record<string, string[]>;
}

const MAX_LS_DEPTH = 20;

/**
 * Walks a parsed `npm ls --all --json` tree and returns only the fields the
 * remediation flow needs: the set of direct dependency names, and, for each
 * transitive package, the deduped list of parent package names that pull it in.
 * All other fields on each node (resolved, integrity, funding, overridden,
 * extraneous, problems, etc.) are intentionally discarded and never propagate
 * to the agent prompt.
 */
export function classifyDependencies(lsRoot: NpmLsRoot): DependencyMap {
    const directDeps = new Set<string>(Object.keys(lsRoot.dependencies ?? {}));
    const parentsSets: Record<string, Set<string>> = {};

    const walk = (node: NpmLsNode | undefined, parentName: string | undefined, depth: number): void => {
        if (!node || depth > MAX_LS_DEPTH) {
            return;
        }
        const deps = node.dependencies;
        if (!deps) {
            return;
        }
        for (const [childName, childNode] of Object.entries(deps)) {
            if (parentName !== undefined) {
                let parents = parentsSets[childName];
                if (!parents) {
                    parents = new Set<string>();
                    parentsSets[childName] = parents;
                }
                parents.add(parentName);
            }
            walk(childNode, childName, depth + 1);
        }
    };

    walk(lsRoot, undefined, 0);

    const parentsByPackage: Record<string, string[]> = {};
    for (const [pkgName, parents] of Object.entries(parentsSets)) {
        parentsByPackage[pkgName] = Array.from(parents);
    }

    return { directDeps, parentsByPackage };
}

export async function readOverrides(repositoryPath: string): Promise<Record<string, unknown>> {
    const packageJsonPath = join(repositoryPath, 'package.json');
    try {
        const raw = await readFile(packageJsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        const overrides = parsed?.overrides;
        if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
            const out: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(overrides)) {
                if (typeof value === 'string') {
                    out[key] = value;
                } else if (
                    value !== null &&
                    typeof value === 'object' &&
                    !Array.isArray(value)
                ) {
                    // Scoped override — e.g. { "tough-cookie": "4.1.4" }
                    out[key] = value;
                }
            }
            return out;
        }
    } catch {
        // package.json missing or malformed — treat as no overrides.
    }
    return {};
}

export async function readPackageJsonRaw(repositoryPath: string): Promise<string> {
    const packageJsonPath = join(repositoryPath, 'package.json');
    try {
        return await readFile(packageJsonPath, 'utf8');
    } catch {
        return '';
    }
}

export interface RestoreResult {
    success: boolean;
    warning?: string;
}

/**
 * After the agent writes package.json, re-applies the new `overrides` value
 * onto the original raw content so that all other formatting (indentation,
 * key ordering, trailing newline) is preserved.
 */
export async function restorePackageJsonFormat(
    repositoryPath: string,
    originalRaw: string,
): Promise<RestoreResult> {
    if (!originalRaw) {
        return { success: false, warning: 'Original package.json content was empty; skipping format restore.' };
    }
    const packageJsonPath = join(repositoryPath, 'package.json');
    try {
        const agentRaw = await readFile(packageJsonPath, 'utf8');
        const agentParsed = JSON.parse(agentRaw) as Record<string, unknown>;
        const newOverrides: unknown = agentParsed['overrides'];

        const originalParsed = JSON.parse(originalRaw) as Record<string, unknown>;

        // Detect indent from original: first indented line wins.
        let indent: string | number = 2;
        for (const line of originalRaw.split('\n').slice(0, 10)) {
            if (line.startsWith('\t')) {
                indent = '\t';
                break;
            }
            const match = line.match(/^( +)/);
            if (match) {
                indent = match[1].length;
                break;
            }
        }

        const trailingNewline = originalRaw.endsWith('\n');

        if (newOverrides !== undefined && newOverrides !== null) {
            originalParsed['overrides'] = newOverrides;
        } else {
            delete originalParsed['overrides'];
        }

        let restored = JSON.stringify(originalParsed, null, indent);
        if (trailingNewline) {
            restored += '\n';
        }

        await writeFile(packageJsonPath, restored, 'utf8');
        return { success: true };
    } catch (err) {
        return {
            success: false,
            warning: `package.json format restore failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

function safeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}
