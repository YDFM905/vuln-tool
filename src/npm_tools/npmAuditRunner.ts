import { spawn } from 'child_process';

export interface NpmAuditResult {
    vulnerabilityDetail: unknown,
    vulnerabilityCounts: unknown,
    rawOutput: string,
    exitCode: number
}

export async function runNpmAudit(repositoryPath: string, signal?: AbortSignal): Promise<NpmAuditResult> {
    return new Promise((resolve, reject) => {
        const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';

        const npmAuditProcess = spawn(command, ['audit', '--json'],
            { cwd: repositoryPath, shell: process.platform === 'win32', signal }
        );

        let stdout = '';

        npmAuditProcess.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        npmAuditProcess.on('error', reject);

        if (signal) {
            signal.addEventListener('abort', () => {
                npmAuditProcess.kill();
            }, { once: true });
        }

        npmAuditProcess.on('close', (exitCode) => {
            const parsedOutput = stdout ? JSON.parse(stdout) : {};
            resolve({
                vulnerabilityDetail: parsedOutput.vulnerabilities ?? [],
                vulnerabilityCounts: parsedOutput.metadata?.vulnerabilities ?? {},
                rawOutput: stdout,
                exitCode: exitCode ?? -1,
            });
        });
    });
}