import { createRequire } from 'node:module';
import type { AgentDefinition } from './agentLoader.js';

const localRequire = createRequire(__filename);

export interface CreateManagedSessionOptions {
	agents: Record<string, AgentDefinition>;
}

export interface SendOptions {
	onDelta?: (delta: string) => void;
	signal?: AbortSignal;
}

export interface ManagedSession {
	send(prompt: string, agentName: string, opts?: SendOptions): Promise<string>;
	dispose(): Promise<void>;
}

function resolveBundledCopilotCliPath(): string {
	const variants = process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform];
	const packageNames = variants.map((variant) => `@github/copilot-${variant}-${process.arch}`);

	for (const packageName of packageNames) {
		try {
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

export async function createManagedSession(options: CreateManagedSessionOptions): Promise<ManagedSession> {
	const copilotsdk = await import('@github/copilot-sdk');

	const runtimePath = resolveBundledCopilotCliPath();
	const runtimeEnv = buildSdkRuntimeEnv();

	const client = new copilotsdk.CopilotClient({
		connection: copilotsdk.RuntimeConnection.forStdio({
			path: runtimePath,
			env: runtimeEnv,
		}),
	});

	await client.start();

	const customAgents = Object.values(options.agents).map((agent) => ({
		name: agent.name,
		displayName: agent.name,
		description: agent.description,
		prompt: agent.body,
	}));

	let currentSession: Awaited<ReturnType<typeof client.createSession>> | undefined;
	let currentAgentName: string | undefined;

	async function ensureSessionForAgent(agentName: string) {
		if (currentAgentName === agentName && currentSession) {
			return currentSession;
		}
		if (currentSession) {
			await currentSession.disconnect();
			currentSession = undefined;
		}
		currentSession = await client.createSession({
			model: 'auto',
			streaming: true,
			onPermissionRequest: copilotsdk.approveAll,
			customAgents,
			agent: agentName,
		});
		currentAgentName = agentName;
		return currentSession;
	}

	return {
		async send(prompt: string, agentName: string, opts?: SendOptions): Promise<string> {
			const session = await ensureSessionForAgent(agentName);

			let removeDeltaListener: (() => void) | undefined;
			if (opts?.onDelta) {
				const onDelta = opts.onDelta;
				removeDeltaListener = session.on('assistant.message_delta', (event: any) => {
					if (event.data?.deltaContent) {
						onDelta(event.data.deltaContent);
					}
				});
			}

			let abortHandler: (() => void) | undefined;
			if (opts?.signal) {
				abortHandler = () => void session.abort();
				opts.signal.addEventListener('abort', abortHandler, { once: true });
			}

			try {
				const response = await session.sendAndWait({ prompt }, 300_000);
				return response?.data.content ?? '';
			} finally {
				removeDeltaListener?.();
				if (opts?.signal && abortHandler) {
					opts.signal.removeEventListener('abort', abortHandler);
				}
			}
		},
		async dispose(): Promise<void> {
			if (currentSession) {
				await currentSession.disconnect();
				currentSession = undefined;
			}
			await client.stop();
		},
	};
}
