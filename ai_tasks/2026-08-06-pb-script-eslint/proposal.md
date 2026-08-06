# Proposal: scaffold an eslint/prettier workspace for pb scriptTask bodies

**Status:** proposal only — no code in this document has been implemented. Written in response to the
2026-08-04/05 feedback's point 4 (`errorCode` set to `''` breaking backend variable reads). That feedback originally
asked for a `pb lint` rule; the shape below is a different mechanism entirely (a scaffolded eslint workspace with
custom rules, run against script bodies), chosen instead of a `pb lint` rule because `pb lint` operates on
`structure.yaml` and never parses script content — teaching it to also reason about JS bodies would fold two very
different kinds of static analysis (graph-structure lint vs. AST lint) into one command and one issue format
(`string[]`, no severity). A dedicated eslint workspace also opens the door to a second, unrelated rule the user
wants: catching `setVariable` calls that only fire on some code paths (e.g. inside `try` but not the corresponding
`catch`). Both problems are ordinary AST-shaped lint, and eslint is a full toolchain for that; `pb lint` is not.

## Why this is feasible

- **The scripts are plain ES5 JavaScript on Activiti**, not Groovy or Python. `pbEdit.js` (`DEFAULT_ATTRS.scriptTask`)
  sets `scriptFormat: 'javascript'` plus `activiti:*` attributes on every scriptTask created through the tool. Eslint
  applies without reservation.
- **The real corpus is ES5 by discipline, not by accident.** Across the 44 sample scripts under
  `ai_tasks/2026-06-18-process-builder-clone/project_output_example_experimental/scripts/`, 43/44 use `var`; zero use
  arrow functions, `const`/`let`, template literals, or `.map`/`.filter`. `scripts/0000_functions.js` hand-rolls ES5
  replacements for those (`arrayMap`, `arrayFilter`, `arrayReduce`, `arrayIncludes`, `formatDateES5`, …) — someone
  already pays this cost by hand, on every script, forever.
- **`eslint-plugin-es5@1.5.0` is already an installed `dependency` of `@waron97/prbot` and is completely unused** —
  zero references anywhere in `src/`, present since the initial commit. Its rules
  (`no-es6-methods`, `no-es6-static-methods`, `no-arrow-functions`, `no-block-scoping`, `no-template-literals`, …)
  catch exactly the class of runtime failure `0000_functions.js` works around by hand. This is close to a freebie:
  wiring it up costs a config file, not new tooling.
- **`agrippa init` already does the equivalent for Python**, and is the right home for this. It writes
  `pyproject.toml` (a ruff config with a `builtins` allowlist for Odoo/Activiti globals like `env`, `log`, `request`),
  `pyrightconfig.json`, and `typings/*.pyi`, each guarded by `existsSync` and an `inquirer` confirm
  (`src/agrippa/commands/init.js`). An `eslint.config.mjs` + `package.json` with a `globals` allowlist
  (`execution`, …) is the direct structural mirror of that `builtins` list.

## Prior art: `example-old-workspace/`

Before agrippa, script edits on a checked-out wizard were done by hand in a throwaway workspace: `bpmn.xml`
(pretty-printed, for reading) + `packed.xml` (for pasting back into the wizard) decomposed by eye into
`src/<ScriptTask>.js` files, edited under a real eslint + prettier + TypeScript setup, then hand-copied back in. This
is very close to what agrippa now automates structurally (`pbProject.js`'s `decompose`/`recompose`), minus the
lint/format/type layer — which was never carried over. Three things from it directly inform this proposal, and one
resolves an open question from the earlier feasibility pass rather than just corroborating it:

- **Confirms the eslint-plugin-es5 origin exactly, not just plausibly.** `example-old-workspace/package.json`'s
  `dependencies`/`devDependencies` (`eslint-plugin-es5@^1.5.0`, `@eslint/js@^9.21.0`,
  `@typescript-eslint/parser@^8.26.0`, `eslint@^9.21.0`, `typescript@^5.8.2`, `typescript-eslint@^8.26.0`) are
  **byte-identical version pins** to what's sitting unused in `@waron97/prbot`'s own `package.json` today. This
  wasn't a vague "someone probably meant to add this" — the versions were copy-pasted from this exact scaffold when
  the feature was started, then the wiring-up step never happened.
- **Confirms the flat-config shape** (`example-old-workspace/eslint.config.mjs`): `eslint-plugin-es5`'s rules
  enumerated individually under `files: ['src/**/*.js']` (its `configs` are eslintrc-shaped and don't spread into
  flat config — matches the caveat already in this proposal), plus `languageOptions.globals: { execution: true }`
  for the injected Activiti global. Directly reusable as the base of the generated `eslint.config.mjs`.
- **Explains the two hand-written `/* eslint-disable @typescript-eslint/no-unused-vars */` directives already
  sitting in the prbot-checked-in sample corpus**, which the earlier feasibility pass flagged as "authors have
  already tried linting these bodies against *some* config" without knowing which. `example-old-workspace` runs
  `typescript-eslint`'s parser over the plain `.js` files (via `ts.config(...)`, with no `parserOptions.project` —
  so no type-aware checking, just its more thorough syntax-level rules) and turns on
  `@typescript-eslint/no-unused-vars: 'warn'`. That's the exact rule name in the corpus's disable comments. Worth
  carrying forward as a lightweight addition: swapping eslint's default parser for `typescript-eslint`'s on plain JS
  files, without a `tsconfig`/type-aware project, costs nothing and gets a better unused-var/no-shadow pass than
  core eslint's own.
- **Corrects a prettier detail the earlier pass got by inference rather than measurement.**
  `example-old-workspace/.prettierrc.json` has no `printWidth` (prettier default: 80). But the real corpus's longest
  lines run up to 98 characters — past 80, under the 100 this proposal already recommends (matching prbot's own
  `.prettierrc.mjs`). So the hand-maintained workspace's own prettier config was apparently never actually the one
  enforced against these files (or wasn't run consistently) — a concrete reason not to copy `example-old-workspace`'s
  `.prettierrc.json` verbatim, and a small piece of evidence that `printWidth: 100` is the right choice here, not a
  guess.

## Feature: auto-generate `types/global.d.ts` instead of hand-maintaining it

`example-old-workspace/types/global.d.ts` types the injected `execution` global against a hand-written `ContextKey`
union — every process variable name the author remembered to list:

```ts
type ContextKey = 'template' | 'request' | 'case_id' | 'isAlive' | 'errorCode' | 'token' | 'errorMessage' | ...;
var execution: {
    setVariable: (key: ContextKey, value: string | number | boolean) => void;
    getVariable: (key: ContextKey) => string | number | boolean;
    getProcessInstanceId: () => any;
};
```

Paired with `jsconfig.json` (`typeRoots: ["./types"]`), this gives editor-time autocomplete and typo-catching on
`setVariable`/`getVariable` calls — a real win, since a misspelled variable name is exactly the kind of error that's
invisible until the variable is read downstream and comes back `undefined`.

**It had already drifted badly by the time this workspace was captured.** Cross-checking the declared `ContextKey`
union against every `setVariable`/`getVariable` first-argument literal actually used across this workspace's own
`src/*.js`: **150 distinct variable names are used; only 21 are declared** — roughly 130 real variables (including
`errorCode` and `isAlive` themselves) give no autocomplete and no typo protection, because nobody went back to update
the union as the wizard grew past its first few scripts. Hand-maintaining this file doesn't scale with a process's
lifetime.

Agrippa can do what manual editing couldn't: **generate this file from the project's actual content**, on `pb pull`
or as part of the eslint-workspace scaffold, by scanning every `scripts/*.js` in a project for
`execution.setVariable`/`execution.getVariable` first-argument string literals and regenerating the `ContextKey`
union from that set (plus statically-known ones like `case_id`). Regenerated, not hand-edited — so it never drifts
the way the manual version did. This is a genuine feature this proposal adds beyond the two eslint rules, and
probably the highest-leverage single item here: it doesn't just catch one bug pattern, it prevents an entire class
(typo'd variable names) directly at the editor, before eslint or a deploy ever runs.

Scope note: this needs its own `pb.js` command or a hook into `pull.js`/`format.js` — it isn't an eslint rule at all,
and doesn't share the "ship inside `@waron97/prbot`'s exported eslint rules" delivery mechanism below. Flagged here
as a design element for the same workspace scaffold, to be sequenced against the two lint rules rather than folded
into their delivery story.

## Where the workspace lives

Pb projects are child directories of the `agrippa.yaml` workspace root, registered in `config.workspace[].path`
(`clonePb.js`). The npm workspace belongs at that **root**, not inside each project:

- One `package.json` + `node_modules` serves every pb/lrp project pulled into the workspace, instead of duplicating
  `node_modules` per project.
- `pull`/`restore` delete any file inside a project's `scripts/` or `pages/` that isn't part of the recomposed map
  (`pullPb.js`, `restore.js`) — a lint config living inside those directories would be destroyed on the next pull.
  The workspace root is untouched by that pruning.
- Glob target: `*/scripts/*.js` — **not** `scripts/*`, since the sample corpus contains a stray non-JS file
  (`scripts/filter.json`) that a bare glob would wrongly pull in. Exclude `*/.backup/**` and `*/preview.svg`.

### Scaffold (written by `agrippa init`, mirroring the existing Python scaffold)

```
workspace/
  agrippa.yaml
  pyproject.toml            # existing
  pyrightconfig.json        # existing
  typings/*.pyi             # existing
  package.json              # new
  eslint.config.mjs         # new
  .prettierrc.mjs           # new
  <project-dir>/scripts/*.js
```

`package.json` devDependencies: `eslint`, `prettier`, `eslint-plugin-es5`, and `@waron97/prbot` itself (see "Rule
delivery" below). npm scripts:

```json
"scripts": {
    "lint": "eslint .",
    "format": "prettier --write '*/scripts/*.js'",
    "format:check": "prettier --check '*/scripts/*.js'"
}
```

`.prettierrc.mjs` mirrors prbot's own (`tabWidth: 4`, `printWidth: 100`, `singleQuote: true`) — the corpus's
prettier-touched files are already in that style.

**`format` writing is accepted as a deliberate normalization, with an explicit caveat that must ship in the tool's
own docs, not just this proposal.** `pbWorkspace.js` writes script bodies byte-exact on purpose ("scripts must not
be reformatted"), and agrippa's checksum comparison (`checksumOfPayload`) is sensitive to that content. Running
`npm run format` therefore produces a real local diff that agrippa classifies as a genuine local change, and the
next `agrippa pb push` sends the reformatted body upstream. That's the tradeoff being taken on here — it should be
surfaced to the user (e.g. in the `agrippa init` output, and in `agrippa-pb.md`) so nobody is surprised by a push
that's "just formatting" turning into a real diff against the remote process.

### Prerequisite: fix the shipped script template first

`src/agrippa/lib/pbScriptTemplate.js` currently scaffolds every new scriptTask with:

```js
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', '');
    execution.setVariable('errorMessage', err.message);
}
```

If a "non-empty errorCode" rule ships before this template is fixed, it fires on every freshly created node until a
human fills it in — false positives from day one, undermining trust in the rule. Change the template's `errorCode`
to `'0'` (the convention for "no error", see below) as a prerequisite of enabling the rule, not an afterthought.

## Rule delivery: ship inside `@waron97/prbot`

The custom rules live in `src/agrippa/eslint/` (already covered by the package's `"files": ["src/"]`), exposed via a
new `package.json` `"exports"` entry:

```json
"exports": { "./eslint": "./src/agrippa/eslint/index.js" }
```

The generated `eslint.config.mjs` does:

```js
import agrippa from '@waron97/prbot/eslint';
export default [agrippa.configs.pbScripts];
```

with `@waron97/prbot` added as a `devDependency` of the generated `package.json`, pinned to the version of the CLI
doing the scaffolding. One source of truth for the rules; a fix or new rule ships to every workspace on `npm i -g .`
+ the next `agrippa init` (or a re-run if init is made idempotent for this file set, matching how it already
re-writes `pyrightconfig.json`/`typings/` behind an `existsSync` guard).

**Risk to flag, not yet resolved:** `@waron97/prbot` is installed **globally**; a local npm install inside the
workspace resolving a *global* package as a devDependency needs the package to be fetchable from whatever registry
the workspace's npm is configured against. Two paths, to be decided before implementation:

1. **Primary:** publish `@waron97/prbot` to a registry the workspace can already reach and let normal npm resolution
   handle it. Needs verification that the registry is reachable without interactively-supplied credentials in a
   scripted/CI context — the repo's own `.npmrc` carries a live plaintext auth token today (gitignored, but present
   on disk), which is a separate hygiene issue worth fixing regardless of this proposal.
2. **Fallback:** at `agrippa init` time, resolve the absolute path of the already-installed global package via
   `import.meta.url` (the same trick `init.js` uses today to find `agrippa_typings/`) and point the generated
   `eslint.config.mjs` at that path directly, bypassing npm resolution for the rules import. Loses "one `npm install`
   picks up everything," gains zero registry dependency.

This proposal does not pick between the two — it should be settled once the registry situation is confirmed at
implementation time.

## Rule 1: `no-empty-error-code`

**Grounding.** Verified at runtime on sorgenia-test-02 and confirmed by the referent (per the original feedback,
`knowledge/gotchas/errorcode-empty-breaks-pb-variable-read.md`): a UserTask reached with `errorCode = ''` makes
`GET /api/processbuilder/v1/process/<key>/<instance>/variable` respond `400 ERR-SYM-007`, and the page never opens,
while the underlying Symphony process stays healthy and `in progress`. `'0'` is the convention for "no error" and
does not trigger the failure.

**Declared limit, to repeat in the rule's own doc comment:** the backend mechanism itself was never inspected — the
`b2w-process-builder`/`b2w-process-builder-runtime` repos aren't reachable with available credentials. The rule
encodes an empirically observed convention (five field observations plus one runtime-confirmed repro), not a
contract read from the Process Builder's source.

**What the rule must handle**, drawn from the real corpus (`execution.setVariable('errorCode', ...)` occurrences
across the sample scripts):

- **Quoting is inconsistent.** Prettier-touched files use single quotes; raw upstream payloads use double quotes
  with tab indentation (`execution.setVariable("showToast",false);`). A rule keyed to a specific quote style misses
  real code — match on the AST node (a `CallExpression` on `execution.setVariable`), not source text.
- **Multi-line calls.** Prettier wraps calls that exceed 100 columns across several lines
  (`0005_init_variables.js:23-26`). AST matching handles this for free; a regex-based rule would not.
- **The second argument varies**: string literal, `''`, an identifier, a concatenation
  (`'PREFIX: ' + err.message`), a boolean, `JSON.stringify(...)`. Only the empty-string-literal case (and, per the
  option below, "some but not all assignments are empty") is the target.
- **The local-variable idiom.** `errorCode` is often accumulated in a local `var` through the body and flushed once
  at the end (`var errorCode = '0'` at the top, reassigned in branches, `execution.setVariable('errorCode',
  errorCode)` once at the bottom) — and in raw upstream payloads sometimes assigned directly with no `setVariable`
  call at all (`errorCode = 'INVALID_COMMODITY';`). A rule that only inspects `setVariable` call sites misses this
  idiom entirely. The rule needs a lightweight intra-function trace of assignments to any identifier ultimately
  passed as the second argument to `setVariable('errorCode', ...)`, not just a literal-argument check.

**Proposed shape:**

- **Definite case** (`--fix`-able): the literal argument to `setVariable('errorCode', ...)` is `''` — autofix to
  `'0'`.
- **Potential case** (the "conditionally empty" scenario the user explicitly wants covered — same shape as rule 2's
  concern, applied to a single variable): within one function, some assignment paths to the tracked identifier
  leave it `''` and others don't. Report under an `allowPotentiallyEmpty` option (default `false`) so a workspace can
  turn this half off if it proves noisy without disabling the definite case.
- Error message cites the concrete failure mode (`400 ERR-SYM-007`, page fails to open) and the convention (`'0'` =
  no error), not just "must not be empty" — so a developer hitting the lint output for the first time has the
  context the original feedback took three dead-end attempts to reconstruct.

## Rule 2: `set-variable-all-paths`

**User's stated goal:** detect a `setVariable` written inside a `try` block but not written on the corresponding
`catch` path (or vice versa) — i.e. a variable that isn't guaranteed to be set on every path out of the script,
which is a distinct, more general problem than rule 1's specific `errorCode` case.

**Proposed v1 shape**, matched to the corpus's actual structure (100% of sample scripts wrap the whole body in one
top-level `try { ... } catch (err) { ... }`):

1. Collect the set of variable names written via `execution.setVariable(name, ...)` (literal `name` only) inside the
   top-level `try` block.
2. Collect the same set inside the top-level `catch` block.
3. Report `try \ catch` — names set on the success path with no corresponding write on the error path.
4. **Do not** report the reverse (`catch \ try`) by default: `isAlive`, `errorCode`, `errorMessage` are
   catch-only by convention across the whole corpus (it's exactly the triple `SCRIPT_TEMPLATE` scaffolds into every
   new script's `catch`), so flagging that direction would fire on essentially every script.

**Declared limits**, to state explicitly in the rule doc rather than leave implicit:

- **Eslint has no control-flow graph.** This is a syntactic, single-level `try`/`catch` check — it does not follow
  nested `if`/`else`, early `return`s, or loops. Scripts with that shape are a known non-goal for v1, not a bug.
- **Absence isn't always a defect.** A variable can legitimately be set by an earlier scriptTask in the same
  process and only conditionally touched here. Ship as a `warn`-severity rule with an `ignoreNames` option, not an
  error, so the false-positive cost of a real but intentional omission stays low.

## What this proposal does not include

- No `pb lint` changes — this is orthogonal tooling, not a graph-structure check.
- No decision on the registry-vs-bundled-path question for rule delivery (see above) — flagged for a decision at
  implementation time.
- No decision on where the `types/global.d.ts` generator lives (new `pb` subcommand vs. a hook into `pull`/`format`)
  — flagged above, to be sequenced separately from the two eslint rules.
- No implementation of either rule, the type generator, the scaffold, or the `package.json`/`eslint.config.mjs`
  templates. This document is the design and feasibility write-up only.
