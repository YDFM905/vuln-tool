import * as vscode from 'vscode';
import { exec } from 'child_process';

// create a dedicated output channel for extension logs
const outputChannel = vscode.window.createOutputChannel("Vulnerability Fixer");


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	console.log('Extension "vulnerability-fixer" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vulnerability-fixer.runTool', async () => {
		// 1. Get target directory (current workspace)
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('Please open a project folder to run the tool.');
			return;
		}

		const targetDirectory = workspaceFolders[0].uri.fsPath;

		// Bring the output channel to the front and clear previous runs
		outputChannel.show();
		outputChannel.clear();
		outputChannel.appendLine(`Starting npm audit in: ${targetDirectory}`);
		outputChannel.appendLine('Please wait...\n');
		outputChannel.appendLine('-----------------------------\n');

		// 2. Execute npm audit command
		// Note: npm audit returns non-zero exit code if vulnerabilities are found
		// 'error' will be populated even if command ran successfully but found vulnerabilities
		exec('npm audit', { cwd: targetDirectory }, (error, stdout, stderr) => {

			// Output the standard result of the audit
			if (stdout) {
				outputChannel.appendLine(stdout);
			}

			// Output any system.execution errors (e.g., npm not install)
			if (stderr) {
				outputChannel.appendLine(`\nWARNING ERROR:\n${stderr}`);
			}

			// If fatal error (not just npm finding vulnerabilities)
			if (error && !stdout) {
				vscode.window.showErrorMessage('Failed to execute npm audit. Check output channel for details.');
				outputChannel.appendLine(`\nFATAL ERROR:\n${error.message}`);
			} else {
				vscode.window.showInformationMessage('Vulnerabilitiy scan complete!');
			}

			outputChannel.appendLine('\n-----------------------------\n');
			outputChannel.appendLine('Scan complete.');
		});
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
