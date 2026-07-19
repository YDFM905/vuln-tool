import * as vscode from 'vscode';
import { setupExtension } from './orchestrator';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	console.log('Extension "vuln-scanner" is now active!');

	// setup and orchestration manageed by orchestrator module
	setupExtension(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
