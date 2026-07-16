# Implement agrippa clone/pull/push for LRPs (Long Running Processes)

## Context

agrippa already syncs Odoo phases, MFAs, and Process Builders (PBs) between disk and the RIP/PB APIs. The user wants the same clone/pull/push workflow for **LRPs** (long running processes). LRPs are structurally near-identical to PBs — both are **Activiti/Symphony BPMN XML** — with three differences:

1. **Different API**: LRPs live behind the Symphony `restInfo/ajax/tabulator` endpoints (same host as `IMPORTEXPORT_URL`), not the PB `/builder/process` API.
2. **No user tasks (pages)**: LRPs never contain `userTask`/pages, so the whole PB page-sync path is skipped.
3. **Tracked by name, not id**: the tabulator `id` changes every save/version (confirmed live: `save.txt` id ≠ current id), so the workspace entry must key on the **stable process name**, re-resolving the current id at each pull/push.

Goal: reuse the PB codebase (BPMN engine, decompose/recompose, checksums, disk layout, dispatch skeleton) as much as possible — one codebase, not two — per the user's explicit direction.

### Key findings (ground-truthed this session)

- The decoded `bpmnFile` (base64 in `save.txt`) is a plain `<definitions><process>…</definitions>` — the **same format `pbModel.js` already parses**. `parseProcess()` handled a real LRP (17 nodes / 20 edges).
- **Corpus round-trip baseline** (789 files in `../../sorgenia_workspace`, run via decompose→recompose→comparePayload): **521/983 pass with 0 diffs, 462 fail, 0 errors**. Every failure is a **dropped node type** (process-kids length mismatch + missing bpmndi shapes), never a parser crash.
- The LRP-only flow-node/element types absent from `pbModel`'s `NODE_TAGS` (census across corpus):
  - `intermediateCatchEvent` (173 files), `callActivity` (148), `parallelGateway` (41), `eventBasedGateway` (16), `intermediateThrowEvent` (2)
  - event-definition children: `messageEventDefinition`, `errorEventDefinition`, `timerEventDefinition` (+`timeDuration`/`timeDate`/`timeCycle`), `terminateEventDefinition`, `signalEventDefinition`
  - loop markers on tasks/callActivity/subProcess: `multiInstanceLoopCharacteristics`, `loopCardinality`, `completionCondition`
  - callActivity data mappings: `in` / `out`
  - definition-level declarations (siblings of `<process>`): `<error>` (already captured as `model.errors`), `<message>`, `<signal>`
- `pbModel` already carries the **inner content of known nodes verbatim** (serviceTask `extensionElements`/`field`/`string` survived round-trip with 0 diffs) — so once a node tag is registered, its children ride along.

### Live API contract (KC Bearer token reaches Symphony — verified)

Base = protocol+host of `IMPORTEXPORT_URL` (reuse `getSymphonyBase()` pattern from `src/commands/exportLrp.js:10`).

- **List / resolve-by-name**: `GET {base}/symphony/restInfo/ajax/tabulator?params=…&connector=SymphBpmnFileTabCon&otherfilters=…&card=true&othersort=…` — rows expose `cellContent1..4` each `{ id, name, tenantId, version, status, bpmnFileSvg }`. Filter `name` (`type:'like'`) + `latestVersion=true`.
- **Detail**: `GET {base}/symphony/restInfo/ajax/tabulator/id/{id}?connector=SymphBpmnFileTabCon&modelroot=/management/development/edit` → JS text; `doc.value` = base64 BPMN, `filename.value` = name. (extraction already in `exportLrp.js:66`.)
- **Save**: `PATCH {base}/symphony/restInfo/ajax/tabulator/{id}?connector=SymphBpmnFileTabCon`, body `{ id, tenantId, newVersion:false, description, name, bpmnFile:<b64 xml>, bpmnFileSvg:<b64>, oldTenantId:tenantId }`.
- **Deploy**: `POST {base}/symphony/restInfo/ajax/deployBpmn`, body `{ id }`.

Everything the save/deploy bodies need (id, name, tenantId, svg) comes from the list row + local BPMN — no extra endpoint required.

## Decisions (confirmed with user)

- **Disk layout**: full PB reuse — LRPs use the same `structure.yaml` + `process.yaml` + `scripts/*.js` + `.agrippa-pb.json` layout.
- **Write scope**: full pull + push (PATCH save) + deploy (POST deployBpmn), deploy prompted like PB publish.
- **SVG**: reuse the remote `bpmnFileSvg` from the tabulator row unchanged (display-only; server deploys from XML).
- **Naming**: CLI flag `--lrp`; stored `object_type: 'long_running_process'`; workspace entries keyed by **name**.

## Approach

### 1. Extend the shared BPMN engine — `src/agrippa/lib/pbModel.js`

This is the substantive work; it benefits PBs too (strictly additive).

- Add to `NODE_TAGS` (line 77): `intermediateCatchEvent`, `intermediateThrowEvent`, `callActivity`, `parallelGateway`, `eventBasedGateway`.
- Add `PROMOTED_ATTRS` entries (line 89) for each new tag (`callActivity` needs `@_calledElement`; events need `@_id`/`@_name`; keep the rest flowing through `extraAttrs`).
- Ensure event-definition children (`messageEventDefinition`, `errorEventDefinition` — note existing `boundaryEvent` handling at line 237 — `timerEventDefinition`+time children, `terminateEventDefinition`, `signalEventDefinition`) and the loop markers (`multiInstanceLoopCharacteristics`/`loopCardinality`/`completionCondition`) and callActivity `in`/`out` are **carried verbatim** as node inner content (same path that preserves `extensionElements`). Verify they are not stripped like `incoming`/`outgoing`/`script`.
- Preserve definition-level `<message>` and `<signal>` declarations (siblings of `<process>`) the way `<error>` is already captured into `model.errors`; otherwise message/signal event refs dangle. Add `model.messages` / `model.signals` and re-emit in `buildProcess`.
- Fix the residual `boundaryEvent` vs `association` ordering diff and the `kids[0].kids[0].attrs.@_id` (event-definition id) drops surfaced in the corpus buckets.
- Re-run the corpus harness after each change; target **983/983 pass, 0 diffs**.

### 2. LRP payload adapter — `src/agrippa/lib/pbProject.js` (minimal)

`decompose`/`recompose` assume a PB payload wrapping the BPMN in `built_page` plus `pages`/`scalars`. The LRP "payload" is the **raw BPMN XML string**. Wrap it losslessly (proven in this session's tests):

- LRP → pseudo-payload `{ built_page: xml }` for `decompose` (no pages ⇒ empty `pages/`, minimal scalars).
- `recompose` → read back `rebuilt.built_page` as the XML to push.
- Store LRP identity (name, current id, tenantId, svg) in `.agrippa-pb.json` manifest — add a small manifest field set, or keep them in the workspace entry only. Prefer the workspace entry for id/tenantId/svg (volatile), manifest for name.

No changes to the four-file layout; `pbWorkspace.js` (writeProject/projectReader) is reused as-is.

### 3. Symphony LRP API client — new `src/agrippa/lib/lrpApi.js`

Mirror `pbApi.js` shape (Bearer `getToken()`, throw on non-ok). Reuse the request-building logic already in `src/commands/exportLrp.js` (`getSymphonyBase`, `fetchProcesses`, `fetchProcessDetail`, `extractBpmnData`). Export:

- `listLrps(token, nameFilter?)` → `[{ id, name, tenantId, version, status, bpmnFileSvg }]` (read all `cellContent1..4`, keep the richer fields, not just id/name).
- `resolveLrpByName(token, name)` → current row (the id-by-name resolution that replaces PB's guid).
- `getLrpXml(token, id)` → `{ xml, filename }` (base64-decode).
- `saveLrp(token, row, xml)` → PATCH tabulator/{id} with the save body; return the response (capture any new id).
- `deployLrp(token, id)` → POST deployBpmn.

### 4. Clone / pull / push handlers — new files mirroring the PB trio

- `src/agrippa/commands/cloneLrp.js` (mirror `clonePb.js`): list → select by `--name` or fuzzy over `name` → dest dir defaults to name with `B2WA_` stripped (mirror `exportLrp.js:129`) → `getLrpXml` → `decompose({built_page:xml})` → `writeProject` → round-trip verify via `comparePayload` → register workspace entry.
  Entry shape: `{ path, object_type:'long_running_process', name, tenant_id, svg, checksum_at_pull: computeChecksum(stableStringify(rebuilt)), version, status }`. **No guid/document_id.**
- `src/agrippa/commands/pullLrp.js` (mirror `pullPb.js`): `resolveLrpByName` → `getLrpXml` → backup → decompose → `pruneOrphans('scripts')` → writeProject → verify. (No `pages` prune.)
- `src/agrippa/commands/pushLrp.js` (mirror `pushPb.js` minus page sync): `recompose` → backup upstream XML → `resolveLrpByName` (current id + tenantId + svg) → `saveLrp` → return summary. `deployLrp` wraps the deploy step (analog of PB `publish`).

### 5. Dispatch + CLI wiring

- `src/agrippa/commands/clone.js`: add `--lrp` fast path (line ~13) and an `LRP` option in the interactive `select` (line ~21) routing to `cloneLrp`.
- `src/agrippa/commands/pull.js`: add an `object_type === 'long_running_process'` branch → `pullLrpEntries` (mirror `pullPbEntries` at line ~123); reuse the shared `unchanged`/`fast-forward`/`conflict` classification with `localChecksum` vs a `remoteChecksum` computed from the freshly fetched XML vs `checksum_at_pull`.
- `src/agrippa/commands/push.js`: add LRP detection + branch (mirror PB at lines ~48–153); locate workspace entry by **name**; after save, run `handleDeploy` (mirror `handlePublish` at line ~167) — prompt unless `--publish`/`--skip-publish` (reuse the existing flags; treat "publish" as "deploy" for LRP).
- `src/agrippa/index.js`: add `--lrp` to `clone`/`pull`/`push` (lines 43–79) alongside `--pb`.

### 6. Local `pb *` editing suite works on LRPs too (in scope)

The `agrippa pb format/add/rm/connect/disconnect/set-default/ls/preview/lint` commands operate purely on `structure.yaml` (no network), so they are already object-type-agnostic except for two touchpoints. Decision (confirmed): **keep the `pb` command group; `--pb <name>` remains the selector for LRPs too** — the workspace entry's `object_type` disambiguates, no new `--lrp` flag on these commands.

- `src/agrippa/commands/pb.js` `resolveProjectPath` (line 40): broaden the filter from `object_type === 'process_builder'` to also include `'long_running_process'`. Match the `--pb <sel>` value against `document_id` **or** `name` (LRP entries have no `document_id`), and show `name` in the fuzzy prompt when `document_id` is absent. Fix the error copy that hard-codes "process-builder wizards".
- `src/agrippa/lib/pbEdit.js`: add the LRP node types to `SIZE` (line 21) and `PREFIX` (line 34) — `intermediateCatchEvent`, `intermediateThrowEvent`, `callActivity`, `parallelGateway`, `eventBasedGateway` — so `add`, `format`, `preview`, and lint size/label/lay them out correctly (`pbLayout.js`/`pbPreview.js` read `SIZE` from here, so they inherit the fix). Guard `pbAdd` so `userTask` isn't scaffolded into an LRP project (LRPs have no pages) — a clear error, since the page/manifest scaffolding at pbEdit.js:150 is PB-only.
- `lintAll` rules (pbEdit.js:401+) are largely generic; review for PB-only assumptions and relax where an LRP-legal graph would falsely fail.

## Files

**New**: `src/agrippa/lib/lrpApi.js`, `src/agrippa/commands/cloneLrp.js`, `pullLrp.js`, `pushLrp.js`.
**Modified**: `src/agrippa/lib/pbModel.js` (node/element coverage — the bulk), `src/agrippa/lib/pbProject.js` (raw-XML payload adapter + LRP manifest fields), `src/agrippa/lib/pbEdit.js` (LRP node-type maps + userTask guard), `src/agrippa/commands/clone.js`, `pull.js`, `push.js`, `pb.js` (resolveProjectPath), `src/agrippa/index.js`.
**Reused unchanged**: `pbWorkspace.js`, `checksum.js`, `pbLayout.js`, `pbPreview.js`, `pbProject.js` core (decompose/recompose/comparePayload/stableStringify/localChecksum), the backup-timestamp + selectEntries conventions.

## Verification

1. **Corpus round-trip harness** (primary gate). Script (prototype exists at `/tmp/rt.mjs`): iterate every `../../sorgenia_workspace/**/*.bpmn20.xml`, `decompose({built_page:xml})` → `recompose` → `comparePayload` (ignoring the no-`pages` diff). **Require 983/983 with 0 diffs.** Baseline today: 521/983. Bucket remaining diffs after each `pbModel` change.
2. **Live pull** (read-only, safe): `agrippa clone --lrp` against the configured test env, pick `B2WA_ml_IFS_passive_trigger`, confirm `scripts/*.js` + `structure.yaml` written and round-trip verifies clean.
3. **Live push + deploy** (write — do with a throwaway/test LRP): edit one script, `agrippa push`, confirm PATCH save returns ok and the tabulator row `status` flips to "Changed from deployed"/draft; then deploy and confirm. Verify the save id vs deploy id behavior against a real save response (the two captured txt files came from different sessions; `newVersion:false` implies in-place, but confirm which id `deployBpmn` wants — the row id or an id returned by the save).
4. `npx eslint src/ && npx prettier --check src/`.
