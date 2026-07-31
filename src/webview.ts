export function getWebviewContent(): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Vulnerability Fixer</title>
        <style>
            :root {
                color-scheme: light;
            }

            html, body {
                width: 100%;
                height: 100%;
                margin: 0;
                font-family: var(--vscode-font-family);
                background: var(--vscode-editor-background);
                overflow: hidden;
            }

            .panel {
                display: flex;
                flex-direction: column;
                width: 100%;
                height: 100vh;
                background: var(--vscode-editor-background);
            }

            .top-bar {
                flex: 0 0 48px;
                display: flex;
                align-items: center;
                padding: 0 20px;
                background: var(--vscode-button-background);
            }

            .top-bar-title {
                color: #ffffff;
                font-size: 14px;
                font-weight: 600;
                user-select: none;
            }

            .body {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 16px;
                padding: 20px 24px 24px;
                background: #ffffff;
                overflow: auto;
                box-sizing: border-box;
            }

            .input-group {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-width: 720px;
            }

            .label {
                font-size: 13px;
                font-weight: 600;
                color: var(--vscode-foreground);
            }

            .repo-input {
                box-sizing: border-box;
                width: 100%;
                min-height: 40px;
                padding: 10px 12px;
                border: 1px solid rgba(0, 0, 0, 0.18);
                border-radius: 8px;
                background: #f0f0f0;
                color: #111111;
                outline: none;
            }

            .repo-input:focus {
                border-color: var(--vscode-button-background);
                box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
            }

            .output {
                flex: 1;
                min-height: 180px;
                padding: 16px;
                border-radius: 12px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                background: #ffffff;
                color: #111111;
                white-space: pre-wrap;
                overflow: auto;
                box-sizing: border-box;
            }

            .output-line {
                margin: 0 0 10px 0;
            }

            .footer {
                flex: 0 0 52px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
                padding: 0 20px;
                background: #e5e5e5;
                box-sizing: border-box;
            }

            .action-button {
                min-width: 110px;
                padding: 10px 18px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }

            .action-button:hover {
                background: var(--vscode-button-hoverBackground);
            }

            .action-button.is-running {
                background: #a63b3b;
            }

            .action-button.is-running:hover {
                background: #8f2f2f;
            }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="top-bar" role="banner">
                <span class="top-bar-title">Vulnerability Remediator Tool</span>
            </div>

            <main class="body">
                <section class="input-group" aria-label="Repository path">
                    <label class="label" for="repositoryPath">Repository path</label>
                    <input id="repositoryPath" class="repo-input" type="text" placeholder="Enter a local repository path" />
                </section>

                <section id="output" class="output" aria-live="polite"></section>
            </main>

            <footer class="footer">
                <button id="runBtn" class="action-button" type="button">Start</button>
            </footer>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const repositoryPathInput = document.getElementById('repositoryPath');
            const output = document.getElementById('output');
            const runButton = document.getElementById('runBtn');

            let running = false;

            function setRunningState(isRunning) {
                running = isRunning;
                runButton.textContent = running ? 'Cancel' : 'Start';
                runButton.classList.toggle('is-running', running);
                repositoryPathInput.disabled = running;
            }

            // function appendOutputLine(text) {
            //     const line = document.createElement('p');
            //     line.className = 'output-line';
            //     line.textContent = text;
            //     output.appendChild(line);
            // }

            function appendOutputText(text) {
                output.textContent += text;

                output.scrollTop = output.scrollHeight; 
            }

            runButton.addEventListener('click', () => {
                if (running) {
                    vscode.postMessage({ type: 'cancelRun' });
                    return;
                }

                setRunningState(true);
                vscode.postMessage({
                    type: 'startRun',
                    repositoryPath: repositoryPathInput.value
                });
            });

            repositoryPathInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !running) {
                    event.preventDefault();
                    runButton.click();
                }
            });

            window.addEventListener('message', (event) => {
                const message = event.data;

                if (!message || typeof message !== 'object') {
                    return;
                }

                if (message.type === 'runState') {
                    setRunningState(Boolean(message.running));
                }

                if (message.type === 'clearOutput') {
                    output.replaceChildren();
                }

                if (message.type === 'output') {
                    appendOutputText(String(message.text));
                }

                if (message.type === 'repositoryPath') {
                    repositoryPathInput.value = String(message.value ?? '');
                }
            });
        </script>
    </body>
    </html>`;
}