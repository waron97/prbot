# Deferred work — agrippa LRP support

Items intentionally punted for later. None block the shipped clone/pull/push/deploy +
`pb *` editing suite, all of which are live-verified (see `implementation.md`).

## 1. `<definitions>`-root whitespace not reproduced byte-for-byte on push

**Status:** open, low priority, user-deferred (harmless).

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
