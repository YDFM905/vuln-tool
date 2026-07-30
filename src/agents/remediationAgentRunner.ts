import { createNpmRemediationTools } from '../copilot_tools/npmRemediationTools.js';
import { REMEDIATION_AGENT_NAME, remediationAgentPrompt } from './remediationAgentPrompt.js';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

const localRequire = createRequire(__filename);

export interface RemediationAgentInput {
    repositoryPath: string;
    baselineAuditOutput: string;
    onProgress?: (message: string) => void;
    signal?: AbortSignal;
}

export interface RemediationAgentResult {
    finalText: string;
    parsedDecision?: unknown;
}

// function resolveBundledCopilotCliPath(): string {
//     const variants = process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform];
//     const packageNames = variants.map((variant) => `@github/copilot-${variant}-${process.arch}`);

//     for (const packageName of packageNames) {
//         try {
//             const sdkEntryPath = localRequire.resolve(`${packageName}/sdk`);
//             return join(dirname(dirname(sdkEntryPath)), 'index.js');
//         } catch (err) {
//             console.warn(`Failed to resolve Copilot CLI runtime package "${packageName}": ${err}`);
//         }
//     }

//     throw new Error(
//         `Unable to resolve bundled Copilot CLI runtime package. Tried: ${packageNames.join(', ')}`,
//     );
// }

// function resolveBundledCopilotCliPath(): string {
//     const variants = process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform];
//     const packageNames = variants.map((variant) => `@github/copilot-${variant}-${process.arch}`);

//     for (const packageName of packageNames) {
//         try {
//             // 1. Resolve the main, officially exported entry point of the package
//             const mainPath = localRequire.resolve(packageName);
            
//             // 2. Extract just the folder name (e.g., 'copilot-win32-x64')
//             const folderName = packageName.split('/')[1]; 
            
//             // 3. Split the absolute path safely using the OS-specific separator
//             const pathParts = mainPath.split(sep);
//             const packageIndex = pathParts.lastIndexOf(folderName);
            
//             if (packageIndex !== -1) {
//                 // 4. Reconstruct the absolute path to the root of that package folder
//                 const packageRoot = pathParts.slice(0, packageIndex + 1).join(sep);
                
//                 // 5. Point directly to the executable file
//                 return join(packageRoot, 'index.js');
//             }
//         } catch {
//             // Try next platform package variant.
//         }
//     }

//     throw new Error(
//         `Unable to resolve bundled Copilot CLI runtime package. Tried: ${packageNames.join(', ')}`,
//     );
// }


function resolveBundledCopilotCliPath(): string {
    const variants = process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform];
    const packageNames = variants.map((variant) => `@github/copilot-${variant}-${process.arch}`);

    for (const packageName of packageNames) {
        try {
            // Simply return the package's officially declared main entry point!
            return localRequire.resolve(packageName);
        } catch {
            // Try next platform package variant.
        }
    }

    throw new Error(
        `Unable to resolve bundled Copilot CLI runtime package. Tried: ${packageNames.join(', ')}`,
    );
}


function buildSdkRuntimeEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') {
            env[key] = value;
        }
    }

    delete env.COPILOT_CLI_PATH;

    return env;
}

function extractJsonObject(content: string): unknown | undefined {
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return undefined;
    }

    const possibleJson = content.slice(firstBrace, lastBrace + 1);
    try {
        return JSON.parse(possibleJson);
    } catch {
        return undefined;
    }
}

export async function runRemediationAgent(input: RemediationAgentInput): Promise<RemediationAgentResult> {
    // Dynamically import the ESM package to avoid CommonJS require() errors
    const copilotsdk = await import('@github/copilot-sdk');

    const runtimePath = resolveBundledCopilotCliPath();
    const runtimeEnv = buildSdkRuntimeEnv();
    
    const client = new copilotsdk.CopilotClient({
        connection: copilotsdk.RuntimeConnection.forStdio({
            path: runtimePath,
            env: runtimeEnv,
        }),
    });
    
    let session: Awaited<ReturnType<typeof client.createSession>> | undefined;

    try {
        input.onProgress?.(`Using Copilot CLI runtime: ${runtimePath}\n`);
        await client.start();
        const tools = await createNpmRemediationTools(input.repositoryPath, input.signal);

        session = await client.createSession({
            model: 'auto',
            streaming: true,
            onPermissionRequest: copilotsdk.approveAll,
            tools: tools as any,
            customAgents: [
                {
                    name: REMEDIATION_AGENT_NAME,
                    displayName: 'NPM Remediation Agent',
                    description: 'Classifies vulnerabilities and applies safe override remediation decisions.',
                    prompt: remediationAgentPrompt,
                },
            ],
            agent: REMEDIATION_AGENT_NAME,
        });

        const removeDeltaListener = session.on('assistant.message_delta', (event) => {
            if (event.data?.deltaContent) {
                input.onProgress?.(event.data.deltaContent);
            }
        });

        if (input.signal) {
            input.signal.addEventListener('abort', () => {
                void session?.abort();
            }, { once: true });
        }

        const prompt = [
            'Repository path:',
            input.repositoryPath,
            '',
            'Baseline npm audit output (JSON):',
            input.baselineAuditOutput,
            '',
            'Execute your remediation workflow now.',
        ].join('\n');

        const response = await session.sendAndWait({ prompt }, 300_000);
        removeDeltaListener();

        const finalText = response?.data.content ?? '';
        const parsedDecision = extractJsonObject(finalText);

        return {
            finalText,
            parsedDecision,
        };
    } finally {
        if (session) {
            await session.disconnect();
        }
        await client.stop();
    }
}