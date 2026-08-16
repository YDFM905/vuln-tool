---
name: package-compatibility-research-v2
description: 'Research whether a MAJOR-version upgrade of a transitive npm package will break the specific parent that imports it.'
user-invocable: false
---

# Package Compatibility Research (v2 — code-level)

## When to Use

Invoked by the `npm-remediation` agent whenever a transitive npm dependency requires a MAJOR-version override to clear a vulnerability.

This skill compares two concrete artifacts: the parent's source at `parentVersion` and the transitive's source (or its exports map) at `targetVersion`. If the parent's import expressions and call sites can be satisfied by the target version's actual exports, the pair is compatible — regardless of what the changelog says.

## Inputs Example (provided by the caller)

| Name | Example | Notes |
|---|---|---|
| `parent` | `inquirer` | The package that pulls in the vulnerable transitive |
| `parentVersion` | `8.2.6` | Pinned installed version of the parent (from `package-lock.json`) |
| `transitive` | `chalk` | The vulnerable transitive package |
| `currentVersion` | `4.1.2` | The transitive version currently used by the parent |
| `targetVersion` | `5.0.0` | The proposed safe major-version target |

## Output Contract

Emit exactly one decision line, followed by a short rationale block. The `npm-remediation` agent parses only the decision word.

```
DECISION: RECOMMENDED | RISKY | UNKNOWN
RATIONALE:
- <one bullet per finding>
```

Decision meanings:
- **RECOMMENDED** — every import expression and call site the parent uses can be resolved against the target version's actual exports.
- **RISKY** — at least one import expression or call site the parent uses cannot be resolved against the target version's actual exports (missing export, wrong module system, removed sub-path, incompatible signature, etc.).
- **UNKNOWN** — parent source or target source cannot be fetched and no confident substitute exists. Treated by the caller as a hard fail.

## Procedure

Follow steps in order. Every step operates on **source-level artifacts**. Do NOT rely on changelogs, release notes, or issue trackers as primary evidence.

### 1. Enumerate the parent's actual usage of the transitive

Fetch the parent's source at the pinned `parentVersion`:

1. Try unpkg first: `https://unpkg.com/<parent>@<parentVersion>/` — enumerate `.js`, `.mjs`, `.cjs`, `.ts`, `.d.ts` files.
2. If unpkg is unreachable or missing files, fall back to the npm registry tarball: fetch `https://registry.npmjs.org/<parent>/<parentVersion>`, extract `dist.tarball`, download and inspect.
3. Also fetch the parent's `package.json` — record its `"type"` (`"module"` or `"commonjs"` / absent) and its `"engines.node"` floor.

Grep every source file for the transitive. For each match, extract into a structured `usage` record:

| Field | Example | How to extract |
|---|---|---|
| `mode` | `cjs` \| `esm` \| `dynamic` | `require(...)` → cjs; `import ... from ...` → esm; `import(...)` → dynamic |
| `subpath` | `""` or `"v4"` | Anything after the package name in the specifier (`require('uuid/v4')` → `"v4"`) |
| `binding` | `chalk` \| `{ v4 }` \| `{ default as X }` | The destructured or aliased symbols |
| `calls` | `["red", "bold", "hex"]` | Every method/property accessed on the binding, gathered via grep of `<binding>.<name>` |

If both unpkg and the registry tarball fail, and no confident source-level knowledge of the parent exists → return **UNKNOWN** with rationale `parent source unavailable for <parent>@<parentVersion>`.

If the parent's source is successfully fetched and contains no reference to the transitive at all → return **RECOMMENDED** with rationale `parent does not import <transitive> in its shipped source`.

### 2. Introspect the target version's actual exported API surface

Fetch the transitive at `targetVersion`:

1. Fetch `https://registry.npmjs.org/<transitive>/<targetVersion>` → download `dist.tarball` OR fetch via `https://unpkg.com/<transitive>@<targetVersion>/`.
2. From the tarball / unpkg listing, read the target's `package.json` and record:
    - `"type"` — `"module"` means the package is ESM by default.
    - `"main"` — the CJS entry point (if present).
    - `"module"` — the ESM entry point (if present).
    - `"exports"` — the exports map. This is the **authoritative** boundary of what consumers can import. If `"exports"` is present, unlisted sub-paths are inaccessible even if the files exist on disk.
    - `"engines.node"` — the Node version floor.
3. Follow `"exports"` (or fall back to `"main"` / `"module"`) to the actual entry file(s). Parse them enough to enumerate:
    - Named exports (`export function foo`, `export const bar`, `module.exports = { foo, bar }`, `exports.foo = ...`).
    - The default export shape (an object with methods? a function? a class?).
    - Sub-path exports declared in `"exports"` (e.g., `"./v4": "./dist/v4.js"`).

Build a structured `targetSurface` record:

| Field | Example | Notes |
|---|---|---|
| `cjsEntry` | `"./dist/index.cjs"` or `null` | If null, `require()` cannot load the package |
| `esmEntry` | `"./dist/index.mjs"` or `null` | If null, `import` cannot load the package |
| `subpaths` | `["v4", "v7"]` | Keys of `"exports"` other than `"."`  |
| `namedExports` | `["red", "bold", "hex", ...]` | Exports of the resolved entry |
| `defaultShape` | `object` \| `function` \| `class` \| `null` | What `const x = require(...)` or `import x from ...` yields |
| `enginesNode` | `">=12"` | From target's `package.json` |

If the target's source cannot be fetched → return **UNKNOWN** with rationale `target source unavailable for <transitive>@<targetVersion>`.

### 3. Cross-reference each usage against the target surface

For every `usage` record from step 1, run the following checks against `targetSurface` from step 2. Any failing check makes the pair **RISKY**.

1. **Module-system compatibility**:
    - `usage.mode === "cjs"` requires `targetSurface.cjsEntry !== null`. If the target dropped CJS (`"type": "module"` with no `"main"` and no CJS entry in `"exports"`), a CJS parent cannot `require()` it → RISKY.
    - `usage.mode === "esm"` requires either `targetSurface.esmEntry` or a CJS entry that Node can interop-import. Modern Node handles CJS-from-ESM, so this rarely fails, but confirm the target's `"exports"` doesn't restrict this.
2. **Sub-path resolution**:
    - If `usage.subpath !== ""`, it must appear in `targetSurface.subpaths`. If the target removed the sub-path (e.g., `require('uuid/v4')` when target's `"exports"` no longer lists `"./v4"`) → RISKY.
3. **Named binding availability**:
    - Every symbol in `usage.binding` (destructured or namespace-imported) must appear in `targetSurface.namedExports`, OR must be a property of `targetSurface.defaultShape` if the parent used a default import.
    - If a symbol is missing → RISKY, and record the missing name in the rationale.
4. **Method call resolution**:
    - Every name in `usage.calls` must appear in `targetSurface.namedExports` or as a property of `targetSurface.defaultShape`. If a called method was removed in the target → RISKY.
5. **Node engine compatibility**:
    - `targetSurface.enginesNode`'s floor must be `<=` the parent's `engines.node` floor. If the target requires a newer Node than the parent claims to support, the pair is technically compatible but the parent's declared support range is broken → RISKY, with the caveat noted in the rationale.

Every check that passes contributes nothing on its own; the decision is driven by the union of failures.

### 4. Emit the decision

- Any check in step 3 fails → **DECISION: RISKY**. List each specific failure in the rationale (e.g., "parent uses `require('chalk')` but target has no CJS entry").
- All checks in step 3 pass → **DECISION: RECOMMENDED**. Rationale should name the concrete evidence (e.g., "parent uses `chalk.red` and `chalk.bold`; both exist as named exports of chalk@5's ESM entry, and parent's imports are ESM").
- Step 1 or step 2 returned UNKNOWN → **DECISION: UNKNOWN** (already emitted from that step).

## Guardrails

- **The changelog is not authoritative.** Do not read the transitive's CHANGELOG.md to decide compatibility in this skill. If the code says one thing and the changelog says another, the code wins. Changelogs miss things; `package.json` `"exports"` maps do not.
- **`"exports"` is the boundary.** If the target's `package.json` has an `"exports"` field, only paths listed there are importable. A sub-path that exists as a file on disk but isn't in `"exports"` is inaccessible to the parent — even in Node 20+.
- **CJS ↔ ESM is a load-time failure, not a call-time failure.** A CJS parent trying to `require()` an ESM-only target fails at module resolution, before any `usage.calls` are even reached. This alone is sufficient for RISKY.
- **Do not confuse "the export exists" with "the export behaves the same".** A signature change (e.g., `foo(a, b)` → `foo({ a, b })`) is not detectable from an exports enumeration alone. If deeper signature inspection is needed and the target's source is minified or bundled such that signatures can't be read, prefer UNKNOWN over an optimistic RECOMMENDED.
- **Never mark RECOMMENDED based on absence of evidence.** If either the parent's source or the target's source can't be inspected, the answer is UNKNOWN.

## Example

Input:
```
parent=inquirer, parentVersion=8.2.6, transitive=chalk, currentVersion=4.1.2, targetVersion=5.0.0
```

Procedure trace:

1. **Step 1 — parent usage:**
    - Fetch `https://unpkg.com/inquirer@8.2.6/`. Enumerate `lib/**/*.js`.
    - Parent's `package.json` shows `"main": "lib/inquirer.js"` and no `"type": "module"` — parent is CJS.
    - Grep for `chalk`. Findings include `const chalk = require('chalk')` at top of multiple files, and calls like `chalk.red(...)`, `chalk.bold(...)`, `chalk.dim(...)`, `chalk.cyan(...)`.
    - Build `usage`:
        - `mode: "cjs"`, `subpath: ""`, `binding: "chalk"` (namespace), `calls: ["red", "bold", "dim", "cyan", ...]`
2. **Step 2 — target surface (chalk@5.0.0):**
    - Fetch chalk@5.0.0's `package.json`. Key fields:
        - `"type": "module"` — the package is ESM by default.
        - No `"main"` field.
        - `"exports": { ".": "./source/index.js" }` — only one entry point, ESM.
    - Follow `"exports"` to `./source/index.js`. Enumerate: default export is a chainable function/object exposing `.red`, `.bold`, `.dim`, `.cyan`, and many more named color/style properties. Also has named exports like `Chalk`, `chalkStderr`, `supportsColor`.
    - Build `targetSurface`:
        - `cjsEntry: null` (no CJS entry declared).
        - `esmEntry: "./source/index.js"`.
        - `subpaths: []`.
        - `namedExports: ["Chalk", "chalkStderr", "supportsColor", "default"]`.
        - `defaultShape: object` — chainable, has `.red`, `.bold`, `.dim`, `.cyan`, etc.
3. **Step 3 — cross-reference:**
    - **Module-system:** `usage.mode === "cjs"` but `targetSurface.cjsEntry === null` → **FAIL**. Parent's `require('chalk')` will throw `ERR_REQUIRE_ESM` against chalk@5.
    - The other checks are moot once the load-time failure is confirmed, but for the record: `.red`, `.bold`, `.dim`, `.cyan` all still exist on chalk@5's default export shape.
4. **Step 4 — decision:**
    ```
    DECISION: RISKY
    RATIONALE:
    - inquirer@8.2.6 is CJS (package.json has no "type": "module") and loads chalk via `require('chalk')`.
    - chalk@5.0.0 declares "type": "module" and its "exports" field lists only an ESM entry (`./source/index.js`) with no CJS fallback.
    - A `require('chalk')` call from inquirer@8.2.6 will fail with ERR_REQUIRE_ESM at module load, before any chalk method is reached.
    ```

Note: this decision is driven entirely by the two `package.json` files and one grep of the parent source. The chalk CHANGELOG is not consulted. If chalk's changelog had failed to mention the CJS drop (as changelogs sometimes do), v1 might have missed this; v2 catches it because `"exports"` is authoritative.
