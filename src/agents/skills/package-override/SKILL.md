# Skill: Package Override Application

Use this skill to apply confirmed override candidates to `package.json` and record all unresolvable items in the final summary.

## Input

Before executing this skill, ensure you have:
- `confirmed[]` — list of packages with a clean, compatibility-approved target version. Each entry: `{ name, targetVersion, parents[] }`.
- `currentOverrides` — the existing `package.json` `overrides` object (read it fresh before applying).
- `unresolvable[]` — list of packages that could not be resolved, each with a reason.

## Override Format Rules

Apply the following logic for each confirmed candidate:

| `parents` length | Override format |
|---|---|
| 0 or absent | Flat: `"<pkg>": "<version>"` |
| 1 – 3 | Scoped per parent: `"<parent>": { "<pkg>": "<version>" }`. Do NOT also write a flat key for the same package. |
| > 3 | Flat: too many parents to scope individually without risking coverage gaps. |

**Multiple parents with different minimum safe versions** (rare): use the highest minimum across all parents.

**Scoped format example** (parents: `["request", "har-validator"]`):
```json
"overrides": {
  "request": {
    "tough-cookie": "4.1.4"
  },
  "har-validator": {
    "tough-cookie": "4.1.4"
  }
}
```

**Flat format example** (no parents or > 3 parents):
```json
"overrides": {
  "tough-cookie": "4.1.4"
}
```

## Merge Rules

- Preserve ALL existing override entries. Never drop unrelated keys.
- If a flat key for the same package already exists alongside new scoped entries, keep both — they coexist inside the top-level `overrides` object without conflict.
- Scoped keys and flat keys at the top level do not interfere with each other.

## Application Steps

1. Read the current `package.json` content.
2. Merge all confirmed overrides into the `overrides` field following the rules above.
3. Write the updated `package.json`.
4. Run `npm install --package-lock-only --ignore-scripts` to confirm the lockfile resolves correctly with the new overrides. If this fails (non-zero exit), report the error; do NOT undo the `package.json` changes — leave them for human review.

## Unresolvable Recording

After applying overrides, emit the following block in your output, even if the list is empty:

```
UNRESOLVED VULNERABILITIES:
- <pkg>: <reason>
```

Use exactly these reason strings:

| Situation | Reason string |
|---|---|
| `isDirect === true` | `direct dependency — out of scope` |
| No version stays within same MAJOR and clears all ranges | `no non-major candidate clears all vulnerable ranges` |
| All candidates within MAJOR still flagged by npm audit after 5 rounds | `no clean version found within 5 rounds` |
| All clean candidates returned RISKY or UNKNOWN from compatibility check | `compatibility check failed for all candidates` |
| npm audit produced no parseable output | `npm audit unreachable during vulnerability check` |

If no packages are unresolvable, emit:
```
UNRESOLVED VULNERABILITIES: none
```
