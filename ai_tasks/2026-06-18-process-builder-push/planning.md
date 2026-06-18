# Planning — `agrippa push` for process-builder wizards

## Goal

Dispatch locally-edited process-builder wizards (cloned via `agrippa clone --pb`) back to the
Process Builder API: save the structure/blocks, save user-task pages, optionally publish.
Builds directly on `ai_tasks/2026-06-18-process-builder-clone` (recompose already produces the
full upstream payload from local files).

## API surface (captured from real UI traffic in `payloads/`)

Base = `PB_URL` (`https://sorgenia-test-02.symple.cloud/api/processbuilder/v1`). Auth: the same
Keycloak bearer agrippa already uses (the captured curls use browser cookies; the GET during
clone proved bearer works — **verify PATCH/POST accept bearer during impl**).

| action | method + path | body |
|---|---|---|
| **save whole wizard** (blocks/structure/scalars) | `PATCH /builder/process/<guid>` | full wizard payload (same shape as GET: `guid`, `built_page`, `pages`, `process_structure`, scalars…) |
| **save existing page** | `PATCH /builder/process/<guid>/page/<page_guid>` | `{ name, page }` |
| **create new page** | `POST /builder/process/<guid>/page` | `{ name, page }` |
| **publish** | `POST /builder/process/publish/<guid>` | `null` |

- `name` = the userTask id (e.g. `UserTask_176nfh6`) = `page._id.stepkey`.
- `page` = exactly the object stored in `pages/<formKey>.yml` (`_id, columns, entities,
  language, page_name, page_builder, profile_info, page_unique_id, mongo_collection,
  generic_information`).
- **The page save is independent of the wizard save** (instructions): in the UI the page popup
  has its own "save" button. So pushing a wizard with page edits = page-endpoint call(s) **and**
  the whole-wizard PATCH. New page flow (per `update_payload_new_page*`): POST the page first,
  then PATCH the wizard whose `built_page` now references the new userTask.
- After any save the wizard is in **`draft`**; it must be **published** for live consumers to
  see changes.

## Push flow (per process_builder workspace entry)

1. **Recompose** the local project dir → `localPayload` (reuse clone's `recompose`): gives
   `built_page`, `pages`, `process_structure`, scalars.
2. **Fetch upstream** (`getProcess(guid)`).
3. **Staleness / conflict check** (see below) → warn + confirm if risky.
4. **Backup** the full upstream payload → `.backup/<ISO-ts>/<path>/upstream.json` (instructions
   require storing the full upstream payload before edits).
5. **Page sync** — authoritative page list = userTask nodes in `structure.yaml` (each points to
   a `pages/*.yml`); manifest supplies the page `guid`/audit:
   - page has a guid (existing) **and** differs from upstream → `PATCH …/page/<guid> {name,page}`
   - page has no guid (newly added userTask) → `POST …/page {name,page}` → record returned guid
     into the manifest
   - page deleted locally (userTask removed) → no DELETE call; the wizard PATCH drops it
     server-side (`remove_pages` keys off built_page userTasks — confirmed in clone recon)
6. **Whole-wizard PATCH** `…/process/<guid>` with `localPayload` (saves blocks/structure;
   mirrors `update_payload_blocks_only` / `…_new_page_inserited`). Wizard → `draft`.
7. **Publish** (optional): `--publish` auto, else prompt; `POST …/publish/<guid>` body `null`.
8. **Persist**: update manifest/workspace — new page guids, `checksum_at_pull`/baseline
   (whatever the conflict strategy uses), upstream `updated_date`/`status`.

## Conflict detection — simpler than the phase/MFA checksum

Phase/MFA use a 3-way checksum (`checksum_at_pull` vs local vs remote). For a whole wizard that's
awkward (the payload is large, server-normalized, and `built_page` is regenerated). Per
instructions, fall back to **upstream state**:

- **Primary: `updated_date`.** Clone stored the upstream `updated_date` (in `manifest.scalars`).
  On push, if upstream `updated_date` ≠ the stored one → upstream changed since clone → **conflict**
  (pushing overwrites someone's work). Warn + confirm (or block without `--force`).
- **Secondary: `status`.** If upstream `status === 'modified'` → there are unpublished draft edits
  upstream; surface that too.
- This is the "look at last-modified dates / upstream state" path the instructions describe. No
  per-field checksum of the wizard.

Backup (step 4) is the safety net regardless of the verdict.

## CLI — unified `push` pipeline (resolved with user)

Same command, **one pipeline** for all object types. `agrippa push`:
1. collects every workspace entry — phase, mfa, **and process_builder**;
2. classifies each → `unchanged` / `fast-forward` / `conflict` (phase/mfa by 3-way checksum; pb
   by local-change + upstream `updated_date`, see below);
3. shows the changed entries in the existing `selectEntries` checkbox UI, each row with its
   status badge (`↑ safe` / `⚠ conflict`);
4. pushes the selected ones (phase→`updatePhase`, mfa→`updateMfa`, pb→`pushPb`);
5. for any pushed pb entry, handles publish (`--publish` auto, `--no-publish` skip, else prompt).

No separate scope/command for pb. Flags: `--publish`, `--no-publish`, `--force` (push despite a
pb `conflict`).

### pb classification (mirrors the phase 3-way logic)

- `localChanged` = `md5(stableStringify(recompose(dir)))` ≠ `entry.checksum_at_pull`
  (so `clonePb` must store `checksum_at_pull` as the md5 of the **recomposed** payload, and an
  `updated_date` baseline).
- `remoteChanged` = upstream `updated_date` ≠ `entry.updated_date`.
- `unchanged` if neither; `fast-forward` if only local changed (remote untouched); `conflict` if
  remote changed since clone. Identical shape to the phase classifier, `updated_date` standing in
  for the remote checksum.

## New code / changes

- `src/agrippa/lib/pbApi.js` — add `updateProcess(guid, payload)` (PATCH), `updatePage(guid,
  pageGuid, body)` (PATCH), `createPage(guid, body)` (POST), `publishProcess(guid)` (POST).
- `src/agrippa/commands/pushPb.js` — orchestration: recompose, fetch, conflict, backup, page
  sync, wizard PATCH, publish, persist.
- `src/agrippa/commands/push.js` — branch process_builder entries to `pushPb`.
- `src/agrippa/lib/pbProject.js` — helper to enumerate local pages from structure.yaml userTasks
  (id, file, page object, guid) for the page-sync diff; small recompose tweak if needed so new
  (manifest-less) pages are included.
- `src/agrippa/index.js` — `push` gains `--publish` / `--no-publish` / `--force`.

## Resolved with user

1. **Conflict strategy** — `updated_date` mismatch (+ `status`), **not** a wizard checksum.
   Handled the *same way* as the existing `push`: classify → badge → select. `--force` to push a
   `conflict` non-interactively. Backup upstream payload regardless.
2. **Page deletion** — rely on the server's `remove_pages` (no DELETE call). ✔
3. **Publish UX** — prompt by default; `--publish` auto; `--no-publish` skip. ✔
4. **Whole-wizard PATCH body** — send the **full** recomposed payload (browser sends full, so do
   we). ✔
5. **Scope** — no separate pb scope; the unified `agrippa push` pipeline (above) handles it. ✔

## Phases

1. `pbApi` write methods; verify bearer auth on PATCH/POST/publish live (against a test wizard).
2. Page-sync: enumerate local pages, diff vs upstream, POST/PATCH.
3. Whole-wizard PATCH + backup + conflict check.
4. Publish (flag + prompt).
5. Wire into `push`; persist manifest/workspace; docs in `implementation.md`.
