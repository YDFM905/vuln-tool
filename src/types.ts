import type { OrchestratorEvent, Phase, RunState } from './pipeline/orchestrator.js';

export type WebviewToExtensionMessage =
	| {
		type: 'startRun';
		repositoryPath: string;
	}
	| {
		type: 'cancelRun';
	}
	| {
		type: 'confirm.response';
		phaseId: string;
		approved: boolean;
	};

export type ExtensionToWebviewMessage =
	| {
		type: 'runState';
		running: boolean;
	}
	| {
		type: 'clearOutput';
	}
	| {
		type: 'output';
		text: string;
	}
	| {
		type: 'repositoryPath';
		value: string;
	}
	| {
		type: 'phase.update';
		phase: Phase;
	}
	| {
		type: 'run.state';
		state: RunState;
	}
	| {
		type: 'event';
		event: OrchestratorEvent;
	}
	| {
		type: 'confirm.request';
		phaseId: string;
		summary: string;
	};