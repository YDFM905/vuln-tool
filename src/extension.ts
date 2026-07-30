import * as vscode from 'vscode';
import { openMainPanel } from './ui/mainPanel.js';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext): Promise<void>{

	console.log('Extension "vuln-scanner" is now active!');

	const runTool = vscode.commands.registerCommand('vulnerability-fixer.runTool', async () => {
		await openMainPanel(context);
	});

	context.subscriptions.push(runTool);

	
}

// This method is called when your extension is deactivated
export function deactivate() {}
