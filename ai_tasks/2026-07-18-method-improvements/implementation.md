# Implementation — reliability hardening batch

Scope decided in `response-to-analyst.md`: implement the subset of
`prbot-agrippa-release-readiness.md` that's a genuine correctness bug or cheap,
dependency-free hardening. Decline the release-governance layer (manifests, planner,
staging, journal/state-machine, pipeline adapter, environment contract, promotion,
rollback, capabilities, secret-store, evidence) as out of scope / blocked on external
contracts (Appendix G).

## What changed

**Central error handling (`src/index.js`, `src/commands/routine.js`)**
- `program.parse()` → `program.parseAsync().catch(fail)`; every action is now `async` and
  awaited, converging on one `fail(err)` that sets `process.exitCode = 1`.
- Added `unhandledRejection`/`uncaughtException` handlers as a regression backstop.
- `--silent` no longer swallows errors (`if (!opts.silent) throw err` removed). Renamed to
  `--quiet`; `--silent` kept as a deprecated alias with a one-line warning, same output
  suppression via the existing `setSilent`/`isSilent` in `src/lib/logger.js` (unchanged).
- `routine` now collects per-step failures and throws an aggregate error if any occurred
  (including unknown commands, previously a silent `continue`) — `prbot routine` now exits
  non-zero if any step failed.

**Auth (`src/lib/auth.js`)**
- `getToken()` checks `response.ok`, validates the body parses as JSON, and validates
  `access_token` is a non-empty string before returning it. Never logs the response body
  (a password-grant endpoint can echo the submitted credentials back on error).

**PB export poll (`src/commands/exportPb.js`)**
- Added a 120s overall deadline to the previously-unbounded `while (true)` poll loop;
  throws `REMOTE_TIMEOUT: ...` on expiry. Correlation (GUID + date-window heuristic) is
  unchanged — a real fix needs the ImportExport API to expose a job/request id (`EXT-002`).
- Exported `pollExportResult` (was internal-only) so it's unit-testable in isolation.

**Agrippa checksum canonicalization + conflict blocking**
- `src/agrippa/lib/pbModel.js`: exported `diagramGeometry` (previously internal-only).
- `src/agrippa/lib/pbProject.js`: added `canonicalForChecksum(payload)` and
  `checksumOfPayload(payload)`. Routes `built_page` through the existing
  `normalizeProcessTree` (drops whitespace-only text nodes, sorts declarations —
  eliminates the `extraDefs` whitespace false-conflict) and `diagramGeometry` (captures
  only x/y/width/height/waypoints — excludes `labelPos` entirely, eliminating that
  false-conflict) instead of hashing the raw recomposed payload. `localChecksum`/
  `remoteChecksumPb` now call `checksumOfPayload`. These are the same primitives the
  983/983 corpus round-trip harness already relies on for 0-loss verification — reused,
  not reinvented.
- Every checksum call site that produces or compares a `checksum_at_pull` baseline
  (`clonePb.js`, `cloneLrp.js`, `pullPb.js`, `pullLrp.js`, plus `push.js`/`pull.js`'s
  classifiers) now goes through this one function, so baselines and comparisons never
  drift apart.
- `src/agrippa/commands/pull.js` `selectEntries`: conflict entries are no longer
  preselected (`checked: e.status !== 'conflict'`); added a `--non-interactive` mode that
  throws if any candidate is `conflict`, otherwise auto-selects the fast-forward set
  without prompting.
- `src/agrippa/commands/push.js`: threaded the same `opts.nonInteractive` through;
  the stale-entry cleanup prompt and the publish/deploy confirm prompts no longer hang
  waiting on stdin in non-interactive mode (default to the safe/no-op choice instead).
- `src/agrippa/index.js`: added `--non-interactive` to both `pull` and `push`.

**Two more checksum root causes, found via a real workspace (2026-07-18, post-batch)**

The user pointed at a live workspace (`sorgenia_workspace/src`, wizard `ml_voltura_preliminary_checks` /
`ML - Verifiche Preliminari Voltura`) that flagged conflict with zero real changes, even
after the batch above. Diagnosed live against the real RIP/PB backend (this machine has
working credentials) — two more root causes, both distinct from the LRP
`extraDefs`/`labelPos`/node-key-order issues in `deferred_work.md`, and both pre-existing
(present before this whole hardening batch, not introduced by it — they live outside
`built_page`, which is all the first canonicalization pass touched):

1. **`updated_date`/`modified_by` audit fields, at both the top-level payload and per-page
   wrapper level.** Odoo/Symple bump these on any touch of the record — observed live,
   `modified_by` had flipped to `integration.b2w@symple.com` (an automation account) with
   zero other content change. They were flowing straight into the checksum via the
   `omit(payload, ['built_page'])` spread, so any server-side touch — including one with no
   semantic effect — permanently pinned the object to `conflict`.
2. **`pages` array order is not a stable identity.** Local `recompose()` rebuilds `pages`
   from `Object.values(manifest.pages)` — insertion order frozen at last decompose (clone
   or push time). A live upstream fetch returns `payload.pages` in whatever order the
   server currently has them, which drifts independently. Observed live: local vs. remote
   had the exact same 3 pages, cyclically rotated by one position — `comparePayload`
   (round-trip verification) didn't catch this either, because its `diff()` returns on the
   *first* mismatch and stopped at page[0]'s `updated_date` before ever reaching the
   reordered pages.

Fixed both in the same `canonicalForChecksum` (`src/agrippa/lib/pbProject.js`): strip
`VOLATILE_AUDIT_FIELDS = ['updated_date', 'modified_by']` from the top-level payload and
from every page wrapper (not from `page.page`, the actual content, which is untouched);
sort `pages` by `guid` before hashing (same trick `normalizeProcessTree` already uses for
`extraDefs` decls — a stable-identity sort in place of array-position comparison).

Verified against the real wizard: before the fix, `localChecksum !== remoteChecksum`
(status `conflict`); after, they're identical and `agrippa pull --non-interactive` /
`agrippa push --non-interactive` both report up-to-date / nothing-to-push against the live
backend. Regression-tested that a genuine content change (real page content, not just
audit fields/order) still produces a different checksum.

Deliberately NOT touched: `recompose()` / the actual push payload construction. The
canonicalization only affects what counts as "changed" for classification — nothing about
what gets sent to Symphony on push changed. This was a scope decision, not an oversight:
the `deferred_work.md` root-cause writeup explicitly says the whitespace bug "only appears
on a real save round-trip," and there's no live Symphony access in this environment to
verify a change to the actual serialization path. Fixing it there remains open.

**Local-command / offline hardening (`src/index.js`)**
- `init`, `ver`, `commit`, `changelog` (verified network/secret-free by reading each file)
  have `KC_USER`/`KC_PASSWORD`/`KC_ID`/`KC_SECRET`/`DEVOPS_TOKEN`/`TRIDENT_TOKEN` deleted
  from `process.env` right after config load, before any command logic runs. Non-secret
  values from the same file (e.g. `ADDONS_PATH`) are untouched.
- `PRBOT_OFFLINE=1` or `--offline` skips the `checkForUpdate()` network call.
- Agrippa's `pb *` local-editing subcommands were already secret-free (only call
  `readConfig()`, never `loadEffectiveEnv`/`getToken`) — no change needed there.

**Packaging (`package.json`)**
- Added `engines.node: ">=20.0.0"` and `packageManager: "npm@10.9.8"`.
- `prbot update [version]` accepts an explicit version; bare `update` still resolves
  latest (unchanged default, now opt-out-able).

## Verification performed (live, in this environment)

- `prbot export workflow --quiet -m <bad>` and the `--silent` variant: both now exit 1 and
  print the real error (previously `--silent` would have swallowed it); deprecation
  warning confirmed on `--silent`.
- `prbot ver <module>` with no `--bump`: clean single-line error, exit 1 (was already a
  sync throw; confirmed it still works under the new async/parseAsync path).
- `routine` with a fixture containing an unknown-command step: via a pty-driven
  interactive run, confirmed the aggregate error and non-zero exit (previously would have
  printed `Failed`/`Unknown command` and exited 0).
- `auth.js` against a local fake Keycloak server in 4 modes (401, missing `access_token`,
  invalid JSON, good): all four behave correctly, no secret leakage in error messages.
- `pollExportResult` against a fake ImportExport server that never returns a match: threw
  `REMOTE_TIMEOUT` at ~120.0s (previously would have hung forever) — timed live, not
  inferred.
- `checksumOfPayload`/`normalizeProcessTree`/`diagramGeometry` against hand-built synthetic
  BPMN payloads: confirmed whitespace-only and labelPos-only diffs produce identical
  checksums, while a genuine scalar/semantic change still produces a different one.
- `selectEntries` (both via direct import and via a pty-driven interactive run): conflict
  entries render unchecked by default; `--non-interactive` throws when a conflict is
  present and auto-selects when only fast-forward entries exist.
- `PRBOT_OFFLINE=1 prbot ver` completed in ~0.15s (no network attempt).
- `prbot update --help` confirms the `[version]` argument is wired — did not actually run
  `update` for real, since this install is dev-symlinked to the repo and a real run would
  overwrite it with the published npm package.
- `node --check` on every touched file; `npx eslint src/` and `npx prettier --check` on the
  full tree show no new errors/warnings beyond the pre-existing baseline (1 pre-existing
  `no-unused-vars` error in `autopr.js`, untouched; 2 pre-existing unformatted files,
  untouched).

No test suite exists in this repo (`npm test` is still the `exit 1` placeholder —
introducing a real one was explicitly out of scope for this batch, see
`response-to-analyst.md`), so all of the above was driven against the live CLI and small
throwaway scripts rather than a checked-in test file.

## Open / explicitly deferred

- PB export job correlation is still a GUID + date-window heuristic (`EXT-002`).
- `built_page` whitespace/`labelPos` round-trip fidelity on the actual push payload is
  unchanged — only the checksum comparison was fixed. See "Deliberately NOT touched" above.
- The `pages`-array-order instability may have a sibling issue in `comparePayload`'s
  round-trip verification itself: its `diff()` short-circuits on the first mismatch, so it
  never actually checked pages[1..3] in the live wizard above (masked by the audit-field
  diff at pages[0]). Round-trip verification silently under-reporting differences (not just
  the checksum) may be worth a closer look — not fixed here, only surfaced during diagnosis.
- No real test suite / CI yet — noted as the natural next step in `response-to-analyst.md`.
