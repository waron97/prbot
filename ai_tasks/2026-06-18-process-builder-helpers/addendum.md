# Addendum — two clone/pull gaps closed

Follow-up to the `pb` helpers, after the user spotted two missing pieces in the
clone/pull surface for process-builder wizards. (`agrippa pb format` and the other
`pb` subcommands always operate on **one** wizard — resolved by `--pb <document_id>`,
single-entry auto-select, or fuzzy prompt; there is no "all wizards" mode.)

## 1. Process Builder choice in the `clone` interactive prompt

`agrippa clone --pb` already worked, but bare `agrippa clone` only offered MFA and
Phase. Added a **Process Builder** choice that routes to `clonePb`.

- `src/agrippa/commands/clone.js`: added `{ name: 'Process Builder', value: 'pb' }`
  to the `select` choices; on `pb`, `return clonePb(opts)`. Moved the `RIP_URL`
  guard to *after* that branch so a PB-only user (no RIP_URL, only PB_URL) isn't
  blocked. `loadEffectiveEnv` runs before the prompt; `clonePb` re-loads it harmlessly.

## 2. `agrippa pull` now refreshes tracked wizards (pull-pb)

Previously `pull` filtered `process_builder` out entirely ("push-only for now").
Now it refreshes tracked wizards from upstream, mirroring `pushPbEntry` with the
concern inverted (pull risks overwriting **local** edits, not remote).

- `src/agrippa/commands/pullPb.js` (new) — `pullPbEntry(token, entry, backupDir, ts)`:
  1. backs up the current local state (recomposed payload → `.backup/<ts>/<path>/local.json`),
  2. `decompose`s the upstream payload to a fresh file map,
  3. **prunes orphan** `scripts/*` and `pages/*` not in the fresh map (so a wizard
     whose nodes were renamed/removed upstream doesn't leave stale files),
  4. `writeProject`, then `recompose` + `comparePayload` to verify 0-loss.
- `src/agrippa/commands/pull.js` — added `pullPbEntries(token, config)`, called after
  the phase/mfa pull and before `discoverNewPhases`. Classification (three-state,
  same `selectEntries` UX as phase/mfa, badges reused):

  | status | meaning |
  |---|---|
  | `unchanged` | upstream `updated_date` not advanced → nothing to bring down |
  | `fast-forward` | remote advanced, local untouched since pull → safe overwrite |
  | `conflict` | remote advanced **and** local diverged → overwrite would lose local work |

  Baselines updated after a successful pull: `checksum_at_pull` (= recomposed
  checksum, same as clone/push), `updated_date`, `status`. Wizards with an
  unreachable upstream are skipped with a warning. New-wizard *discovery* is out of
  scope (wizards aren't grouped under a parent like phases under a workflow).

### Symmetry note

`checksum_at_pull` is the recomposed-payload checksum across clone, push, and pull
(`localChecksum` / `computeChecksum(stableStringify(recompose))`), so the three
commands agree on what "local == last synced" means.

## Validation

- **pull-pb offline** (fixture `ml_review_billing` as upstream against a seeded
  project with planted orphan `scripts/9999_orphan.js` + `pages/zzz_orphan.yml`):
  orphans pruned, round-trip `comparePayload` = **0 diffs**, `local.json` backup
  written, `status`/`updated_date` carried from upstream.
- **clone prompt**: bare `agrippa clone` now lists MFA / Phase / Process Builder;
  selecting Process Builder delegates to `clonePb`.
- `eslint` on `pull.js` / `pullPb.js` / `clone.js`: 0 errors (only repo-wide
  `no-console` warnings). CLI loads (`agrippa pull --help`, `agrippa clone --help`).

## Deferred (unchanged)

- New-wizard discovery on `pull` (only tracked wizards refresh).
- `process_structure` regeneration (server regenerates on publish).
