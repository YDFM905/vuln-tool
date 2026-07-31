# Skill: Package Compatibility Research

Use this skill to assess whether upgrading `<pkg>` from `<vFrom>` to `<vTo>` is safe for the main application and all parent packages that depend on it.

## Input

Before executing this skill, ensure you have:
- `pkgName` — the npm package name
- `vFrom` — the currently installed version
- `vTo` — the candidate target version
- `parents[]` — the list of parent package names that pull this package in (from the injected audit report)

## Research Protocol

Execute the following sources in order. Record your finding from each source before moving to the next. Do not skip a source unless it is genuinely inaccessible.

### Source 1: Package homepage and repository URL

Run `npm view <pkgName> homepage` to retrieve the homepage URL. Infer the GitHub repository URL from it — most npm packages link directly to their GitHub repo. If `homepage` is empty or unhelpful, run `npm view <pkgName> repository.url` as a fallback. Record the resolved GitHub `<owner>/<repo>` for use in Sources 2 and 3.

### Source 2: GitHub compare view

Using the resolved repository, fetch:
```
https://github.com/<owner>/<repo>/compare/v<vFrom>...v<vTo>
```
via the web fetch tool. Scan the diff for:
- Removed or renamed exported symbols
- Changed function signatures or return types
- Removed configuration options or changed defaults
- Any commits with messages containing "breaking", "BREAKING", or "removed"

Record what you find. If the URL returns 404 or is inaccessible, record "inaccessible" and proceed to Source 3.

### Source 3: CHANGELOG

Attempt to fetch one of these URLs (try in order, stop at the first success):
- `https://raw.githubusercontent.com/<owner>/<repo>/v<vTo>/CHANGELOG.md`
- `https://raw.githubusercontent.com/<owner>/<repo>/main/CHANGELOG.md`
- `https://raw.githubusercontent.com/<owner>/<repo>/master/CHANGELOG.md`

Read only the entries between `vFrom` and `vTo`. Record any explicit breaking change notes. If no CHANGELOG is found, record "not found".

### Source 4: Parent package peer/dependency constraints

For each package in `parents[]`, run:
```
npm view <parent> peerDependencies
```
Check whether the range specified for `<pkgName>` includes `<vTo>`. If any parent's declared range excludes `<vTo>`, record it as a blocker.

### Source 5: npm deprecation flag

Run:
```
npm view <pkgName>@<vTo> deprecated
```
If the output is non-empty, the target version carries a deprecation notice. Record the message.

## Decision Rules

Apply these rules after collecting all available evidence:

| Condition | Decision |
|---|---|
| No breaking evidence found in any accessible source; all parent peer ranges include `<vTo>`; no deprecation at `<vTo>` | **RECOMMENDED** |
| Any parent peer range excludes `<vTo>`; OR any source explicitly notes a breaking change or removed export; OR `<vTo>` is deprecated | **RISKY** |
| GitHub compare AND CHANGELOG both inaccessible or not found; AND no parent peer constraint data available | **UNKNOWN** |

When multiple conditions apply, the most restrictive decision wins (RISKY beats UNKNOWN beats RECOMMENDED).

## Required Output Format

After completing all sources, produce the following block exactly:

```
COMPATIBILITY ASSESSMENT: <pkgName> <vFrom> → <vTo>
Decision: RECOMMENDED | RISKY | UNKNOWN
Evidence:
  - Source 1 (homepage/repo): <finding>
  - Source 2 (GitHub compare): <finding>
  - Source 3 (CHANGELOG): <finding>
  - Source 4 (parent peer deps): <finding>
  - Source 5 (deprecation): <finding>
Skip reason (if RISKY or UNKNOWN): <one sentence, or "N/A">
```

## Termination Rule

- If Decision is **RECOMMENDED**: advance the candidate to the apply step.
- If Decision is **RISKY** or **UNKNOWN**: do NOT apply the override. Record the skip reason in the final summary.
