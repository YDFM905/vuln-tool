export type WebviewToExtensionMessage =
	| {
		type: 'startRun';
		repositoryPath: string;
	}
	| {
		type: 'cancelRun';
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
	};