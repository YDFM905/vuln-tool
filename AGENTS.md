# AGENTS.md

## Mission
Build a VS Code extension that remediates vulnerabilities in Node.js applications by applying safe patch/minor dependency changes for direct and transitive dependencies.

## Non-Negotiables
- Keep the remediation workflow modular so AI-driven edits are easy to reason about and debug.
- Keep orchestration in [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts); keep helpers in the narrow tool modules under [src/general_tools](src/general_tools) and [src/npm_tools](src/npm_tools).
- Prefer small, reversible edits over broad refactors.
- Do not move behavior into [src/extension.ts](src/extension.ts); that file should stay thin.

## Workflow Contract
Preserve this sequence when implementing the remediation flow:
1. Accept user repository input.
2. Run `npm audit` to capture the baseline vulnerability count.
3. Run `npm audit fix` for safe automatic remediations.
4. Classify unresolved vulnerabilities by fix type.
5. Apply targeted dependency changes, including `overrides` when transitive pins require them.
6. Re-validate and confirm the fix reduced vulnerabilities without introducing new ones.
7. Produce a deterministic report from the collected run artifacts.

## Agent Topology
- Use exactly two working agents for the remediation workflow: one classification agent and one fix-application agent.
- The classification agent should consume audit output, lockfile/package metadata, and the current dependency graph, then return grouped vulnerability classes with a recommended remediation strategy.
- The fix-application agent should consume the classification result and repository manifests, then return concrete edits plus validation results.
- Do not add a third reporting agent; reporting must stay scripted and deterministic.

## Decision Policy
- Default to upgrade-first for pinned transitive dependency conflicts.
- Choose a conservative alternative, including a downgrade path, when a major version boundary, peer dependency conflict, known incompatibility, or failed validation makes the upgrade risky.

## Codebase Map
- Extension entrypoint: [src/extension.ts](src/extension.ts)
- Pipeline control point: [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts)
- Repository input helper: [src/general_tools/repositoryInput](src/general_tools/repositoryInput)
- npm audit runner: [src/npm_tools/npmAuditRunner.ts](src/npm_tools/npmAuditRunner.ts)
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
