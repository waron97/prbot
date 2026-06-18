# Implementation notes — `agrippa push` (process-builder)

Running log of what gets built and why. See `planning.md` for the agreed design. **Not started
yet — awaiting plan review** (open questions in planning.md).

## Confirmed from the captured payloads (`payloads/`)

- Whole-wizard save: `PATCH {PB_URL}/builder/process/<guid>` with the **full** wizard payload
  (same shape as GET). Seen in `update_payload_blocks_only.txt` and
  `update_payload_new_page_inserited.txt`.
- Existing page save: `PATCH {PB_URL}/builder/process/<guid>/page/<page_guid>` body `{name, page}`
  (`update_payload_existing_page.txt`).
- New page: `POST {PB_URL}/builder/process/<guid>/page` body `{name, page}`
  (`update_payload_new_page.txt`).
- Publish: `POST {PB_URL}/builder/process/publish/<guid>` body `null` (`publish_payload.txt`).
- `name` = userTask id = `page._id.stepkey`; `page` = the `pages/*.yml` object verbatim.
- Captured curls authenticate with browser cookies; agrippa will use the existing Keycloak
  bearer (proven for GET during clone) — **must verify bearer on PATCH/POST/publish.**

## Decisions (to confirm in review)

- Conflict detection by upstream `updated_date` (stored at clone in `manifest.scalars`) +
  `status` surfacing, not a wizard checksum. Backup full upstream payload regardless.
- Page list driven by `structure.yaml` userTask nodes (authoritative); manifest supplies page
  guids. New (manifest-less) pages → POST, then persist the returned guid.
- Page deletion handled server-side via `remove_pages` on the wizard PATCH (no DELETE call).

## Files added / changed

- `src/agrippa/lib/pbApi.js` — `updateProcess` (PATCH wizard), `createPage` (POST), `updatePage`
  (PATCH page), `publishProcess` (POST); `pbRequest` now sends bodies.
- `src/agrippa/commands/pushPb.js` — `pushPbEntry` (backup → page sync → wizard PATCH) + `publish`.
- `src/agrippa/commands/push.js` — rewritten to the unified pipeline (phase+mfa+pb, classify →
  badge → select → push → publish).
- `src/agrippa/lib/pbProject.js` — `stableStringify`, `localChecksum`, `enumeratePages`.
- `src/agrippa/lib/pbWorkspace.js` — `listPageFiles`.
- `src/agrippa/commands/clonePb.js` — `checksum_at_pull` now hashes the *recomposed* payload;
  store `updated_date` + `status` baselines for push classification.
- `src/agrippa/commands/pull.js` — excludes process_builder entries (pull-pb is a future task).
- `src/agrippa/index.js` — `push` gains `--publish` / `--skip-publish`.

## Build findings (things that bit, and the fix)

- **Page↔userTask link is `page._id.stepkey`, not a node ref.** First cut had `enumeratePages`
  scan structure.yaml userTask nodes for a `page:` field — but clone never writes one, so it
  found zero pages (page PATCH/POST never fired). Fixed: `enumeratePages` is **filesystem-driven**
  — scan `pages/*.yml`, key each by `page._id.stepkey`, get the upstream guid from the manifest
  (no guid ⇒ a locally-added page ⇒ POST).
- **Save status is `modified`, not `draft`, for previously-published wizards.** The API uses
  `draft` for never-published and `modified` for "published with pending edits". push records the
  status returned by the wizard PATCH rather than assuming `draft`.
- **Checksum baseline must match what push computes.** clone now stores
  `checksum_at_pull = md5(stableStringify(recompose(dir)))` (the same value push recomputes), so a
  fresh clone classifies as `unchanged`. (The old `md5(JSON.stringify(rawUpstream))` never matched
  the recomposed local form.)

## Validation — live, against real wizards (bearer auth accepted on all writes)

Tested on disposable `[DA ELIMINARE]` wizards:
- **Wizard save + backup** (`modify_voltage`): edited a script → `pushPbEntry` → upstream
  `built_page` contains the edit; `.backup/<ts>/<path>/upstream.json` written; status flips,
  `updated_date` changes.
- **Page PATCH + publish** (`ml_client_contact_condominium`): edited a page's `page_name` →
  `updated=1`, marker present upstream; `publish` → upstream `status = published`.
- **New page POST** (same wizard, dropped a manifest guid to simulate a locally-added page):
  `created=1`, upstream page count `2 → 3`.
- **CLI unified pipeline**: fresh `clone --pb` then `agrippa push` → "Nothing to push —
  everything matches" (pb classified `unchanged`).

## Status

- [x] phase 1 — pbApi write methods + live bearer-auth check
- [x] phase 2 — page sync (enumerate, diff, POST/PATCH)
- [x] phase 3 — whole-wizard PATCH + backup + conflict check (classify via localChecksum +
      upstream `updated_date`)
- [x] phase 4 — publish (`--publish` / `--skip-publish` / prompt)
- [x] phase 5 — wired into unified `push`; clone stores push baselines; pull skips pb

## Deferred

- **pull for pb** — bring upstream wizard changes back into local files (symmetry with push).
- Conflict resolution beyond badge+backup (e.g. 3-way merge) — out of scope; matches existing
  phase/mfa behavior (select + overwrite + backup).
