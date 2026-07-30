# AGENTS.md

## Mission
Build a VS Code extension that remediates vulnerabilities in Node.js applications by applying safe patch/minor `overrides` for transitive dependencies. Direct dependencies not fixable by `npm audit fix` are out-of-scope; they require application source-code changes.

## Non-Negotiables
- Keep the remediation workflow modular so AI-driven edits are easy to reason about and debug.
- Keep orchestration in [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts); keep helpers in the narrow tool modules under [src/general_tools](src/general_tools) and [src/npm_tools](src/npm_tools).
- Prefer small, reversible edits over broad refactors.
- Do not move behavior into [src/extension.ts](src/extension.ts); that file should stay thin.

## Workflow Contract
The remediation flow is a three-phase pipeline. Phases 1 and 3 are scripted and deterministic; phase 2 is agent-driven.

1. **Scan & audit (scripted)**:
    - Accept user repository input.
    - Run `npm audit --json` for a baseline vulnerability report.
    - Run `npm audit fix --json` to apply safe automatic remediations.
    - Re-run `npm audit --json` to capture post-fix state.
    - Run `npm ls --all --json` and parse the tree down to `{ directDeps, parentsByPackage }` — discarding `resolved`, `integrity`, `funding`, `overridden`, `extraneous`, `problems`, and every other field — so the agent's prompt stays compact.
    - Build an `AuditReport` with baseline/post-fix counts and a `remaining` array of vulnerable packages annotated with `isDirect` and (for transitives) `parents`.
2. **Remediation (agent)**:
    - If the `remaining` array is empty, skip the agent and mark the phase complete.
    - Otherwise inject the `AuditReport` and current `package.json.overrides` into the agent prompt. The agent classifies remaining items, selects target versions within the same MAJOR, researches compatibility, and writes `overrides` for confirmed transitive candidates. Direct dependencies are always skipped.
3. **Final report (scripted)**:
    - Re-run `npm audit --json` post-remediation.
    - Diff `package.json.overrides` against the pre-remediation snapshot.
    - Emit a concise report: baseline → post-audit-fix → post-remediation counts, plus per-override diff.

## Agent Topology
- Use exactly one remediation agent, bookended by scripted `scan-audit` and `final-report` phases.
- The remediation agent consumes the pre-computed `AuditReport` and current `overrides`, then emits `package.json` `overrides` for confirmed transitive candidates. Classification of direct vs. transitive is scripted (via `classifyDependencies` in [src/npm_tools/npmAuditRunner.ts](src/npm_tools/npmAuditRunner.ts)) and injected as prompt input — there is no separate classification agent.
- Do not add a reporting agent; the final report stays scripted and deterministic.

## Decision Policy
- Direct dependencies still vulnerable after `npm audit fix` are out-of-scope. They require application source-code changes that this tool will not perform.
- No major-version changes, for any dependency (direct or transitive). If no non-major version patches the vulnerability, mark it unresolvable.
- Every proposed override MUST be compatibility-researched before it is applied (CHANGELOG, GitHub release notes, GitHub compare view via `web/fetch`, peer/dependency constraints of parent packages). Skip and record as unresolved when in doubt.

## Codebase Map
- Extension entrypoint: [src/extension.ts](src/extension.ts)
- Main panel (class): [src/ui/mainPanel.ts](src/ui/mainPanel.ts)
- Pipeline control point: [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts)
- Copilot session manager: [src/agents/sessionManager.ts](src/agents/sessionManager.ts)
- Agent registry loader: [src/agents/agentLoader.ts](src/agents/agentLoader.ts)
- Bundled remediation agent prompt: [src/agents/npm-remediation.md](src/agents/npm-remediation.md)
- Scripted npm helpers (audit, audit fix, ls parsing, overrides): [src/npm_tools/npmAuditRunner.ts](src/npm_tools/npmAuditRunner.ts)
- Repository input helper: [src/general_tools/repositoryInput.ts](src/general_tools/repositoryInput.ts)
- Shared contracts: [src/types.ts](src/types.ts)
- Webview UI: [src/webview.ts](src/webview.ts)
- Tests: [src/test/extension.test.ts](src/test/extension.test.ts)

## Development Commands
- Build: `npm run compile`
- Watch: `npm run watch`
- Test: `npm run test`
- Lint: `npm run lint`
- Type-check: `npm run check-types`

## Working Rules For Coding Agents
- Keep commands, validation output, and remediation decisions reproducible.
- Update or add helper modules instead of embedding workflow logic in the entrypoint or UI.
- Validate after each remediation cycle before expanding scope.
- Keep user-facing output deterministic where possible.

## Documentation Linking
- Project README: [README.md](README.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)

If new implementation docs are added, link to them here rather than duplicating long-form guidance.

