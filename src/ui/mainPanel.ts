import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadAgents, type AgentDefinition } from '../agents/agentLoader.js';
import { createManagedSession, type ManagedSession } from '../agents/sessionManager.js';
import { Orchestrator, type OrchestratorEvent, type RunState } from '../pipeline/orchestrator.js';
import { getWebviewContent } from '../webview.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types.js';

class MainPanel {
	private workspaceRoot: string;
	private agents: Record<string, AgentDefinition> = {};
	private session?: ManagedSession;
	private orchestrator?: Orchestrator;
	private currentRunController?: AbortController;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly panel: vscode.WebviewPanel,
	) {
		this.workspaceRoot = this.resolveWorkspaceRoot();
	}

	async initialize(): Promise<void> {
		this.agents = await loadAgents(this.resolveAgentDirs());
		this.session = await createManagedSession({
			agents: this.agents,
		});
		this.orchestrator = new Orchestrator(this.session, this.agents, this.workspaceRoot, {
			onPhaseUpdate: (phase) => this.post({ type: 'phase.update', phase }),
			onEvent: (event) => this.forwardEvent(event),
			awaitConfirmation: (phaseId, summary) => this.askConfirmation(phaseId, summary),
			onRunState: (state) => this.forwardRunState(state),
		});

		this.wireMessages();
		this.wireDispose();
	}

	private resolveWorkspaceRoot(): string {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			throw new Error('Open a folder to use Vulnerability Fixer.');
		}
		return folder.uri.fsPath;
	}

	// Precedence (later entries override earlier ones on name collision):
	//   1. Bundled defaults shipped with the extension
	//   2. User-level overrides in ~/.copilot/agents
	//   3. Workspace-level overrides in <workspaceRoot>/agents
	private resolveAgentDirs(): string[] {
		return [
			path.join(this.context.extensionPath, 'dist', 'agents'),
			path.join(os.homedir(), '.copilot', 'agents'),
			path.join(this.workspaceRoot, 'agents'),
		];
	}

	private post(message: ExtensionToWebviewMessage): void {
		void this.panel.webview.postMessage(message);
	}

	private forwardEvent(event: OrchestratorEvent): void {
		if (event.type === 'output' && typeof event.payload === 'string') {
			this.post({ type: 'output', text: event.payload });
		}
		// Additional event surfacing lands in future plans (Plan B/C).
	}

	private forwardRunState(state: RunState): void {
		this.post({ type: 'run.state', state });
		// Backward compatibility with the existing webview which only knows `runState`.
		this.post({ type: 'runState', running: state === 'running' });
	}

	// PLAN C: real confirmation UI. For now, auto-approve everything.
	private async askConfirmation(_phaseId: string, _summary: string): Promise<boolean> {
		return true;
	}

	private wireMessages(): void {
		this.panel.webview.onDidReceiveMessage(
			(message: WebviewToExtensionMessage) => {
				if (message.type === 'startRun') {
					void this.startRun(message.repositoryPath);
					return;
				}
				if (message.type === 'cancelRun') {
					this.currentRunController?.abort();
				}
			},
			undefined,
			this.context.subscriptions,
		);
	}

	private wireDispose(): void {
		this.panel.onDidDispose(() => {
			void this.dispose();
		}, null, this.context.subscriptions);
	}

	private async startRun(repositoryPath: string): Promise<void> {
		if (this.currentRunController || !this.orchestrator) {
			return;
		}

		const controller = new AbortController();
		this.currentRunController = controller;
		this.post({ type: 'clearOutput' });

		try {
			await this.orchestrator.run({ repositoryPath, signal: controller.signal });
		} catch (err) {
			if (!controller.signal.aborted) {
				const message = err instanceof Error ? err.message : String(err);
				this.post({ type: 'output', text: `Run failed: ${message}\n` });
			}
		} finally {
			if (this.currentRunController === controller) {
				this.currentRunController = undefined;
			}
		}
	}

	async dispose(): Promise<void> {
		this.currentRunController?.abort();
		this.currentRunController = undefined;
		if (this.session) {
			await this.session.dispose();
			this.session = undefined;
		}
	}
}

export async function openMainPanel(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
	const panel = vscode.window.createWebviewPanel(
		'vulnerabilityFixerMain',
		'Vulnerability Fixer',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
		},
	);

	panel.webview.html = getWebviewContent();

	const mainPanel = new MainPanel(context, panel);
	try {
		await mainPanel.initialize();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		void panel.webview.postMessage({ type: 'output', text: `Initialization failed: ${message}\n` });
	}

	return panel;
}