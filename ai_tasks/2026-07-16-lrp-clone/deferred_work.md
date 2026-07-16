# Deferred work — agrippa LRP support

Items intentionally punted for later. None block the shipped clone/pull/push/deploy +
`pb *` editing suite, all of which are live-verified (see `implementation.md`).

## Resolved this session (2026-07-16, not deferred)

**Deploy fired with a stale id → save persisted but deploy activated nothing.** This was
the implementation.md Open item ("`res.saved?.id ?? res.newRow.id` unverified"). The save
mints a new id (LRPs are name-keyed for exactly this reason), so the pre-save id is dead
the moment `saveLrp` returns; `deployBpmn {id: <pre-save>}` returned 200 but activated
nothing, leaving the remote at `status: Changed from deployed`. **Fix:** `pushLrpEntry`
now re-resolves by name AFTER the save and returns `deployId` (the fresh id) +
`newRow` from that fresh row; `push.js` deploys `res.deployId`. Live-verified: remote
flipped `Changed from deployed` → `Deployed`, and the stale-`version` drift (push had
been storing the pre-save row's version) is fixed by the same re-resolve. Files:
`src/agrippa/commands/pushLrp.js`, `src/agrippa/commands/push.js`.

## 1. `<definitions>`-root whitespace not reproduced byte-for-byte on push

**Status:** open, user-deferred. **Severity upgraded** — see "Consequence" and item 3:
combined with item 3 it makes every pushed LRP show a permanent phantom `[conflict]`, so
it is no longer purely cosmetic.

**Symptom.** First real LRP push+deploy (`ml_get_invoices_for_case`, 2026-07-16). A
fresh re-clone from remote differed from the pristine clone in exactly one place —
`structure.yaml` `extraDefs`:

```
original clone:   #text: "\n  "        (×3)
after push:       #text: |+  (block)   (×3)
```

Semantically null: whitespace *between* top-level XML declarations (`<message>` /
`<process>` siblings at the `<definitions>` root). No node, edge, field, script, or
geometry affected. Everything else round-trips byte-identical (28 nodes / 30 edges /
8 scripts all IDENTICAL against the fresh remote re-clone).

**Consequence.** Every LRP push emits this one cosmetic delta vs the pristine-cloned
XML. It does not compound and does not affect behavior.

**Why it slipped the corpus harness.** The 983/983 corpus round-trip runs
decompose→recompose→compare in-process; this only appears on a real *save* round-trip
(the serializer reformats/reindents definitions-root whitespace on rebuild).

**Fix sketch.** In `src/agrippa/lib/pbModel.js` / `pbProject.js`, preserve the original
`extraDefs` raw-passthrough `#text` whitespace exactly rather than re-emitting it. Verify
against a real push re-clone diff, not just the in-process harness.

## 2. `agrippa diff` on directory-backed entries (PB / LRP)

**Status:** open, minor.

- `agrippa diff <lrp-or-pb-path>` → `No tracked files match the given path.` (diff's path
  selector is phase/MFA-file scoped; PB/LRP dir entries are not matched).
- bare `agrippa diff` (whole workspace) → crashes `Error: EISDIR: illegal operation on a
  directory, read` when it hits a directory-backed entry.

Likely pre-existing (PB dirs would trip the same path), not LRP-specific — confirm, then
either teach `diff` to decompose/compare dir entries or skip them cleanly instead of
crashing.

## 3. Phantom `[conflict]` on every re-push of a pushed LRP

**Status:** open, medium priority (degrades the push/pull UX; no data loss).

**Symptom.** After a successful push, re-running `agrippa push` (or `pull`) classifies the
same LRP as `[⚠ conflict]` even though nothing was touched locally and the push succeeded.

**Root cause.** The local-recompose checksum never equals the remote-fetch checksum, so
classification sees both sides as "diverged from the pull baseline." The differences are
all cosmetic round-trip artifacts, none behavioral:

- **extraDefs whitespace** (item 1).
- **`format`-generated `labelPos`** (item 4) — present locally, never persisted to remote.
- **node key-order** — locally-added nodes serialize `layout:` before `script:`; a fresh
  recompose/reclone emits `script:` before `layout:` (same data, different YAML key order).

**Verified.** `ml_get_invoices_for_case`: local vs fresh remote reclone diff = exactly
these three (scripts byte-identical, 30 nodes / topology identical).

**Fix sketch.** Make the checksum canonical/normalized so cosmetic serialization choices
don't count: sort node keys canonically, normalize `extraDefs` whitespace, and either
persist `labelPos` or exclude it from the checksum. Ideally the same canonicalization the
corpus harness uses (which reports 0 diffs) should feed the push/pull classifier.

## 4. `format` generates `labelPos` that push silently drops

**Status:** open, minor (visual only — edge-label placement).

**Symptom.** `agrippa pb format` synthesizes `labelPos` (edge-label geometry) for named /
conditioned flows — measured 0 `labelPos` before format → 4 after, on
`ml_get_invoices_for_case`'s error edges. On push, recompose does not emit them, so the
remote (and any reclone) has 0. Edge labels fall back to default placement in the diagram.

**Fix sketch.** Either serialize `labelPos` into the pushed BPMN (`<bpmndi:BPMNLabel>` with
bounds) so format's label placement survives, or don't generate it locally if it can't be
persisted. Feeds item 3's phantom conflict until resolved.

## 5. Local vs remote `status` capitalization mismatch

**Status:** open, cosmetic.

`push.js` writes the literal `status: deployed` (lowercase) after deploy, while Symphony
reports `Deployed` (capital) — so a reclone shows `Deployed` and a just-pushed entry shows
`deployed`. Harmless; align the literal to the server's casing (or normalize on read).
