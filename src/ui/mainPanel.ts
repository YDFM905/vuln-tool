import * as vscode from 'vscode';
import { runPipeline } from '../pipeline/orchestrator.js';
import { getWebviewContent } from '../webview.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types.js';

export function openMainPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
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

	let currentRun: AbortController | undefined;

	const postMessage = (message: ExtensionToWebviewMessage): void => {
		void panel.webview.postMessage(message);
	};

	const setRunningState = (running: boolean): void => {
		postMessage({ type: 'runState', running });
	};

	const stopCurrentRun = (): void => {
		if (!currentRun) {
			return;
		}

		currentRun.abort();
		currentRun = undefined;
		setRunningState(false);
		postMessage({ type: 'output', text: 'Run cancelled.' });
	};

	const startRun = async (repositoryPath: string): Promise<void> => {
		if (currentRun) {
			return;
		}

		const controller = new AbortController();
		currentRun = controller;
		setRunningState(true);
		postMessage({ type: 'clearOutput' });

		try {
			await runPipeline(repositoryPath, {
				signal: controller.signal,
				onOutput: (message: string) => {
					postMessage({ type: 'output', text: message });
				},
			});
		} catch (error) {
			if (!controller.signal.aborted) {
				const message = error instanceof Error ? error.message : String(error);
				postMessage({ type: 'output', text: message });
			}
		} finally {
			if (currentRun === controller) {
				currentRun = undefined;
			}
			setRunningState(false);
		}
	};

	panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
		if (message.type === 'startRun') {
			void startRun(message.repositoryPath);
			return;
		}

		if (message.type === 'cancelRun') {
			stopCurrentRun();
		}
	});

	panel.onDidDispose(() => {
		currentRun?.abort();
		currentRun = undefined;
	}, null, context.subscriptions);

	return panel;
}