export function getWebviewContent(): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Vuln Scanner</title>
        <style>
            body {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                font-family: var(--vscode-font-family);
            }
            button {
                padding: 12px 24px;
                font-size: 16px;
                cursor: pointer;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <button id="runBtn">Run Tool</button>

        <script>
            const vscode = acquireVsCodeApi();
            
            document.getElementById('runBtn').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'runTool'
                });
            });
        </script>
    </body>
    </html>`;
}