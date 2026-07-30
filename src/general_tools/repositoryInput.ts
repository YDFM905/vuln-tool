import * as vscode from 'vscode';
import { access } from 'node:fs/promises';

export async function getRepositoryPath(repositoryPathInput?: string): Promise<string> {
	const repositoryPath = repositoryPathInput ?? await vscode.window.showInputBox({
		prompt: 'Enter target repository path',
		placeHolder: 'e.g., /path/to/your/repository',
		ignoreFocusOut: true,
	});

	if (repositoryPath === undefined) {
		throw new Error('provided repository path is undefined');
	}

	const parsedPath = repositoryPath.trim();

	if (!parsedPath) {
		throw new Error('Repository path cannot be empty');
	}

	try {
		await access(parsedPath);

		return parsedPath;
	} catch (error) {
		throw new Error(`The provided repository path does not exist: ${parsedPath}`);
	}
}