---
name: package-compatibility-research-v3
description: 'Research whether a MAJOR-version override of a transitive npm package will break its specific parent, using exact local node_modules artifacts first and focused source-level compatibility checks.'
user-invocable: false
---

# Package Compatibility Research

## When to Use

Invoked by the `npm-remediation` agent when a transitive npm dependency requires a MAJOR-version override.

This skill compares the exact installed parent with the current and target transitive artifacts. It minimizes tool output while retaining source-level confidence: search local files first, inspect only relevant entry points and used APIs, and stop as soon as a decisive incompatibility is proven.

## Inputs

| Name | Example |
|---|---|
| `parent` | `inquirer` |
| `parentVersion` | `8.2.6` |
| `transitive` | `chalk` |
| `currentVersion` | `4.1.2` |
| `targetVersion` | `5.0.0` |

## Output Contract

Emit exactly one decision line followed by a short rationale. The caller parses only the decision word.

```
DECISION: RECOMMENDED | RISKY | UNKNOWN
RATIONALE:
- <one bullet per material finding>
```

- **RECOMMENDED** - all reachable imports and uses are compatible, including module resolution, API signatures, runtime behavior visible from source, environment support, and public type references.
- **RISKY** - at least one concrete incompatibility exists.
- **UNKNOWN** - required artifacts or behavior cannot be inspected confidently. The caller treats this as a hard fail.

## Cost Controls

1. Prefer exact local artifacts and targeted text searches. Do not begin with web fetches or directory-wide file reads.
2. Read manifests before source. They identify shipped files, module boundaries, entry points, conditions, and engine constraints cheaply.
3. Search all candidate files in one operation, then read only matching files and the target modules that satisfy those usages.
4. Compare only APIs the parent actually uses. Do not enumerate an entire target package when a few exports suffice.
5. Run independent manifest lookups in parallel when possible.
6. Stop immediately after a decisive RISKY or UNKNOWN result; do not collect redundant evidence.
7. Keep the final rationale to material evidence. Do not emit the full procedure trace.

## Procedure

Follow these steps in order. Changelogs, release notes, issue trackers, and README examples are not primary compatibility evidence.

### 1. Resolve the exact installed parent

Use `node_modules` as the primary source.

1. Locate every local `node_modules/<parent>/package.json`, including nested and workspace layouts. For scoped names, preserve the scope directory.
2. Select only an artifact whose manifest version equals `parentVersion`. Do not silently analyze another installed version.
3. Resolve `<transitive>/package.json` from that exact parent's directory and verify it equals `currentVersion`. This is the authoritative current artifact; do not choose an unrelated hoisted or nested copy.
4. Record the parent's `type`, `main`, `module`, `exports`, `browser`, `files`, and `engines.node` fields.
5. Determine the shipped/runtime file set from `exports`, entry fields, `files`, and package contents. Include lazily loaded modules reachable from shipped entry points and public `.d.ts` files; exclude tests, examples, docs, maps, and vendored dependencies unless they are exported or loaded at runtime.

If no exact local parent exists, fall back to unpkg:

1. Fetch `https://unpkg.com/<parent>@<parentVersion>/package.json` first.
2. Fetch only shipped source files needed to search and trace the transitive usage.
3. If unpkg is unavailable or incomplete, use the npm registry metadata and exact tarball.

If the exact parent cannot be inspected from any source, return **UNKNOWN** with `parent source unavailable for <parent>@<parentVersion>`.

### 2. Enumerate every parent usage

Search the candidate parent files once for exact package specifiers covering:

- `require('<transitive>')` and `require('<transitive>/<subpath>')`
- static `import` and `export ... from`
- dynamic `import(...)`
- `require.resolve(...)` and `createRequire(...)(...)`
- public declaration-file imports such as `import('<transitive>').Type`

Reject accidental text matches in comments, documentation, source maps, lockfiles, and the parent's dependency declaration. If a specifier is computed and cannot be resolved statically, return **UNKNOWN**.

For each real match, trace aliases and local re-exports far enough to capture every reachable use. Build a compact usage record:

| Field | Meaning |
|---|---|
| `mode` | `cjs`, `esm`, `dynamic`, `resolve`, or `type` |
| `conditions` | Resolution conditions implied by Node/browser and import/require |
| `subpath` | Root (`""`) or exact imported subpath |
| `binding` | Default, namespace, named, destructured, or side-effect-only |
| `operations` | Property reads, calls, constructors, tagged calls, iteration, mutation, or re-export |
| `arguments` | Argument count and relevant argument/option shapes |
| `expectations` | Sync/async use, return shape, errors relied upon, and public type exposure |

If inspected shipped source has no real reference to the transitive, return **RECOMMENDED** with `parent does not import <transitive> in its shipped source or public declarations`.

### 3. Resolve current and target artifacts

Inspect the exact `currentVersion` and `targetVersion`; never substitute a nearby version.

1. Reuse an exact local `node_modules/<transitive>` artifact when available.
2. Otherwise fetch its manifest from unpkg or registry metadata, then fetch only the entry files, declarations, and implementation files needed by the usage records.
3. For each version, record `type`, `main`, `module`, `exports`, `browser`, `types`/`typings`, `engines.node`, and required peer dependencies.
4. Resolve every used root/subpath through the authoritative `exports` map under the usage's actual ordered conditions, including any runtime, bundler, platform, or caller-supplied custom conditions. If no `exports` map exists, apply the consumer's normal entry-point rules.
5. Follow re-exports to the concrete implementation and declaration files for only the used symbols.

If the target artifact or a required implementation cannot be inspected, return **UNKNOWN** with `target source unavailable for <transitive>@<targetVersion>` or name the unresolved API.

### 4. Check compatibility

Any failure below makes the result **RISKY**.

#### A. Module and resolution compatibility

- Every CJS use must resolve to code loadable by `require()` on every Node version the parent supports. An ESM-only target is incompatible even if modern Node can sometimes synchronously require ESM.
- Every ESM/dynamic use must resolve under the applicable import conditions.
- Every exact subpath, including wildcard exports, must remain exported under the same conditions.
- Default, namespace, named, side-effect-only, and re-export bindings must retain the shape expected by the parent. Account for CJS/ESM interop rather than assuming named exports are synthesized.
- If the parent has browser-shipped code, validate browser conditions separately from Node conditions.

#### B. Used API compatibility

Compare the current implementation/declarations with the target for every used API. Confirm:

- the symbol exists and has the expected value kind: function, class, object, primitive, or type;
- call and constructor signatures accept the parent's argument count and argument/option shapes;
- required options were not added and used options were not removed or renamed;
- sync/async behavior and relevant return-value shape remain compatible;
- accessed properties and methods remain available at the point they are used;
- mutations, callbacks, iteration, thrown errors, and side effects the parent relies on remain valid.

An export-name match alone is insufficient. If bundled/minified/dynamic code prevents a confident comparison of a relied-upon behavior, return **UNKNOWN**, not RECOMMENDED.

#### C. Runtime and install compatibility

- The parent's entire declared `engines.node` range must be contained by the target's supported range. If any Node version accepted by the parent is rejected by the target, return **RISKY** and name the range mismatch.
- Check required platform globals and built-ins visible in the used target path, such as `crypto`, `fetch`, or newer Node APIs, against the parent's supported environments.
- New required peer dependencies must be satisfiable by the parent's package contract; missing or incompatible required peers are RISKY. Optional peers are material only when the used path requires them.

#### D. Public type compatibility

When the parent publicly references transitive types, verify target declarations resolve under the parent's supported TypeScript/module-resolution modes and preserve the used type names and compatible shapes. Private build-only type changes do not affect the decision for already-shipped JavaScript.

### 5. Optional discriminating runtime probe

Static source is authoritative, but a tiny probe may disconfirm a tentative RECOMMENDED result when both exact packages are locally resolvable. Use the cheapest probe that mirrors the parent's real usage, such as loading the same root/subpath and invoking the used API with representative valid arguments.

- A failed probe is **RISKY** when it demonstrates the real incompatibility.
- A passing probe supports but never replaces the source checks.
- Do not install or override packages in the user's project merely to run a probe.

### 6. Emit the decision

- Any concrete failure in Step 4 or 5 -> **DECISION: RISKY**.
- All applicable checks pass with inspectable evidence -> **DECISION: RECOMMENDED**.
- Missing, ambiguous, generated, native, or dynamic behavior prevents confidence -> **DECISION: UNKNOWN**.

For RECOMMENDED, cite the parent's exact import and used APIs, the target paths that satisfy them, and the engine/type result. For RISKY, list each decisive mismatch. For UNKNOWN, list only the evidence gap.

## Guardrails

- **Verify exact versions.** A local package with the right name but wrong version is not evidence.
- **`exports` is authoritative.** Files outside an exports map are inaccessible even when present on disk.
- **Package scope controls module type.** Honor the nearest `package.json`, including nested build directories that override `type`.
- **Resolution conditions matter.** Check all applicable built-in and custom conditions in the order the actual consumer will, including `node`, `browser`, `import`, `require`, and `default` where relevant.
- **Compare behavior, not only names.** Existing exports can still have breaking signatures, return types, defaults, or side effects.
- **Do not infer compatibility from a latest Node runtime.** Evaluate the parent's declared support contract unless the caller explicitly supplies a narrower runtime range.
- **No evidence is UNKNOWN, not RECOMMENDED.**
- **Do not use changelogs as the deciding evidence.** Source, declarations, manifests, and focused runtime probes win.

## Example Output

```
DECISION: RISKY
RATIONALE:
- inquirer@8.2.6 loads chalk with `require('chalk')` from its shipped CommonJS files.
- chalk@5.0.0 exports only an ESM root and provides no `require` condition or CommonJS fallback.
- The parent fails at module loading before any chalk method can run.
```