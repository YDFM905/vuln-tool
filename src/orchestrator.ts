import * as vscode from 'vscode';
import { getWebviewContent } from './webview';
import { runNpmAudit } from '../services/scannerService';
import type { WebviewMessage } from './types';

export function setupExtension (context: vscode.ExtensionContext) {
    
}