# Vulnerability Remediator Tool

A VS Code extension that uses GitHub Copilot to automatically remediate npm vulnerabilities in Node.js repositories by researching and applying safe `overrides` for transitive dependencies.

## Features

### Three-phase automated pipeline

1. **Scan & Audit** — Runs a baseline `npm audit`, applies `npm audit fix` for automatic safe remediations, re-audits to capture what remains, and classifies every remaining vulnerable package as direct or transitive using `npm ls`.
2. **Remediation (AI-driven)** — Invokes a GitHub Copilot agent that selects target patch versions, researches backwards compatibility (changelog, GitHub compare view, peer dependency constraints), and writes scoped `overrides` entries into `package.json` for confirmed transitive vulnerabilities. Direct dependencies that cannot be fixed automatically are recorded as out-of-scope.
3. **Final Report** — Re-audits after remediation and emits a concise diff: baseline → post-audit-fix → post-remediation vulnerability counts, plus a per-entry overrides diff showing what was added, changed, or removed.

### Safety guardrails enforced by the agent

- **No major-version changes** — the agent only considers versions within the same MAJOR as the currently installed package.
- **Scoped overrides by default** — overrides are scoped to their immediate parent package(s) (`"parent": { "pkg": "version" }`) to minimise blast radius.
- **Compatibility research before every override** — the agent uses a bundled skill (`package-compatibility-research`) that checks the GitHub compare view, CHANGELOG, npm deprecation flags, and parent peer-dependency constraints before proposing any change. An override is only applied if the research returns a `RECOMMENDED` decision.
- **Direct dependencies are never touched** — packages listed in `dependencies` or `devDependencies` that remain vulnerable after `npm audit fix` require source-code changes and are explicitly marked out-of-scope.

### Skills system

Agent behaviour is defined in versioned markdown files under `src/agents/`. Reusable research protocols live in `src/agents/skills/`. The bundled skill `package-compatibility-research` teaches the agent how to assess backwards compatibility from evidence (not semver alone). Skills are hot-reloadable — editing a `.md` file takes effect on the next run without a rebuild.

## Requirements

- **VS Code** 1.85 or later
- **GitHub Copilot** subscription (Pro or above) with Claude Sonnet access enabled
- **Node.js** and **npm** installed and on `PATH` in the target repository environment
- The target repository must have a `package.json` and a `package-lock.json` (npm v7+ lockfile format)

## Extension Settings

This extension does not contribute VS Code settings at this time. Model selection and agent behaviour are configured directly in `src/agents/sessionManager.ts` (model) and `src/agents/npm-remediation.md` (agent prompt and tools).

## How to use

1. Open the repository you want to scan in VS Code as a workspace folder.
2. Run the command **Vulnerability Fixer: Run Tool** from the Command Palette (`Ctrl+Shift+P`).
3. In the panel that opens, enter the absolute path to the target Node.js repository in the input field.
4. Click **Start**. The three pipeline phases will run in sequence; output streams live to the panel.
5. When the run completes, review the Final Report section for vulnerability counts and override changes. Inspect the modified `package.json` in the target repository to confirm the overrides before committing.

## Known Issues

- **`model not available` error** — GitHub Copilot model identifiers in the SDK may differ from display names. If you see this error, check `src/agents/sessionManager.ts` and try `'auto'` to let the runtime select a model, then identify the working identifier from the session logs.
- **Private npm registries** — The agent uses `npm view` to query package versions and `web/fetch` to retrieve changelogs and GitHub compare views. Packages that exist only in a private Artifactory registry without a public GitHub repository will produce `UNKNOWN` compatibility decisions and be skipped.
- **`npm audit fix` side effects** — The scan phase runs `npm audit fix`, which modifies `package-lock.json`. Run on a branch and review the lockfile diff before merging.

## Release Notes

### 0.0.1

Initial pre-release. Core three-phase pipeline (scan-audit / agent remediation / final report), scoped overrides, compatibility research skill, and the agent loader/skills system.

---

## Project structure

```
src/
  extension.ts              # Extension entrypoint (thin)
  types.ts                  # Shared webview message contracts
  webview.ts                # Webview HTML/CSS/JS
  agents/
    agentLoader.ts          # Discovers and parses agent .md files
    sessionManager.ts       # Copilot client + session lifecycle
    npm-remediation.md      # Remediation agent prompt + frontmatter
    skills/
      package-compatibility-research/
        SKILL.md            # Compatibility research protocol
  copilot_tools/
    npmRemediationTools.ts  # Custom defineTool() wrappers (reserved)
  general_tools/
    repositoryInput.ts      # Repository path validation
  npm_tools/
    npmAuditRunner.ts       # npm audit / audit fix / ls / classify helpers
  pipeline/
    orchestrator.ts         # Three-phase pipeline driver
    phaseStreamParser.ts    # Sentinel marker stream parser (reserved)
  ui/
    mainPanel.ts            # WebviewPanel class + lifecycle
  test/
    extension.test.ts       # Extension tests
```

## For more information

- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [npm overrides documentation](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides)
- [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)

