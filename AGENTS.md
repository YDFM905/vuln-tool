# AGENTS.md

## Mission
Build a VS Code extension that remediates vulnerabilities in Node.js applications by applying safe patch/minor dependency changes for direct and transitive dependencies.

## Scope
In scope:
- Run vulnerability discovery and remediation workflows for user-selected repositories.
- Apply patch/minor upgrades and controlled downgrades when needed to resolve vulnerabilities.
- Use `overrides` and targeted package updates when transitive dependencies are pinned.
- Validate that fixes reduce vulnerability count without introducing regressions.

Out of scope (current phase):
- Automated direct major-version upgrade capability.

## Workflow Contract
Implement and preserve this sequence:
1. Accept user repository input.
2. Run `npm audit` to capture baseline vulnerability count.
3. Run `npm audit fix` for safe automatic remediations.
4. Run classification logic to group unresolved vulnerabilities by fix type.
5. Run fix-application logic to update dependency declarations (including `overrides` when appropriate).
6. Re-validate vulnerabilities and confirm no new vulnerabilities were introduced.
7. Produce a final scripted report summarizing changes and rationale.

## Agent Topology (Hard Constraint)
Use exactly two working agents:
1. Classification agent
- Inputs: audit output, lockfile/package metadata, current dependency graph.
- Output: grouped vulnerability classes with recommended remediation strategy.

2. Fix-application agent
- Inputs: classification output and repository manifests.
- Output: concrete edits (`package.json`, lockfile, overrides) plus validation loop results.

Do not add a third reporting agent in this phase.

## Reporting Mode (Hard Constraint)
Final reporting must be scripted/deterministic for now.
- Generate a structured report from collected run artifacts.
- Include before/after vulnerability counts, packages changed, and why each change was selected.

## Decision Policy
Default policy for pinned transitive dependency conflicts is upgrade-first.

Override the default and choose conservative alternatives (including downgrade paths) when one or more risk signals appear:
- Upgrade requires crossing a major version boundary.
- Declared peer dependency ranges are violated.
- Known incompatibility appears in package metadata/changelog/tests.
- Validation loop shows breakage or introduces new vulnerabilities.

## Development Commands
From this extension repository:
- Build: `npm run compile`
- Watch: `npm run watch`
- Test: `npm run test`
- Lint: `npm run lint`
- Type-check: `npm run check-types`

## Current Architecture Map
- Activation entrypoint: [src/extension.ts](src/extension.ts)
- Orchestration boundary: [src/orchestrator.ts](src/orchestrator.ts)
- Webview UI content: [src/webview.ts](src/webview.ts)
- Message and shared contracts: [src/types.ts](src/types.ts)
- Future service layer (scanner/classifier/fixer/reporter scripts): [src/services](src/services)

Keep orchestration in `orchestrator.ts`; keep execution details in `src/services/*`.

## Working Rules For Coding Agents
- Prefer minimal, reversible edits with clear rationale.
- Do not refactor unrelated code while implementing workflow steps.
- Preserve reproducibility: log commands run and key outputs used for decisions.
- Validate after each remediation cycle before proceeding.
- Keep user-facing behavior deterministic where possible.

## Documentation Linking
- Project readme (currently scaffold-level): [README.md](README.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)

If new implementation docs are added (architecture, contribution, troubleshooting), link to them from this file rather than duplicating long-form guidance here.
