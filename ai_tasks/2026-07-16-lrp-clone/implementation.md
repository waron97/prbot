# Implementation notes — agrippa LRP support

Running log of what was built and why. See `planning.md` for the agreed design (written and
approved in plan mode before implementation started) and `instructions.md` for the raw request.

## Current design (authoritative end state)

`agrippa clone --lrp [--name <process_name>] [--path <dir>]` downloads a long-running process
(LRP) from Symphony and decomposes it into the **same** `structure.yaml`/`scripts/`/manifest
layout as a process-builder (PB) wizard — LRPs and PBs are both plain Activiti/Symphony BPMN XML,
so the existing PB decompose/recompose/checksum engine (`pbModel.js`/`pbProject.js`) is reused
almost entirely unchanged. `agrippa pull`/`agrippa push`/`agrippa pb *` all work on LRP entries
too. Publishing an LRP is called **deploy** (`POST .../deployBpmn`), mirroring PB's publish step.

**Key structural difference from PB**: LRPs have no stable id. The Symphony tabulator `id`
changes on every save/version bump (confirmed live — a re-fetched id differed from a previously
captured one for the same process). So unlike PB (keyed by `guid`), **LRP workspace entries are
keyed by `name`** — every pull/push re-resolves the current id/tenantId by name immediately
before acting on it (`fetchUpstream`/`resolveLrpByName` in `lrpApi.js`).

**No pages.** LRPs never contain `userTask`, so the whole PB page-sync path (`enumeratePages`,
`createPage`/`updatePage`) is skipped entirely for LRPs. `pbAdd` explicitly rejects
`--type userTask` when the target is an LRP.

## Phase 0 — exploration and API discovery

- Explored the existing PB stack (`clonePb.js`/`pullPb.js`/`pushPb.js`, `pbApi.js`,
  `pbModel.js`, `pbProject.js`, `pbEdit.js`) via a subagent to map what's genuinely generic vs
  PB-specific, and the existing `exportLrp.js`/`exportPb.js` (prbot side, not agrippa) via a
  second subagent for the LRP API shape already in use for `prbot export lrp`.
- Decoded the user-provided `save.txt`/`deploy.txt` (browser "copy as fetch" captures) to get the
  real save/deploy request shapes:
  - **Save**: `PATCH {host}/symphony/restInfo/ajax/tabulator/{id}?connector=SymphBpmnFileTabCon`,
    body `{ id, tenantId, newVersion:false, description, name, bpmnFile:<b64 xml>,
    bpmnFileSvg:<b64>, oldTenantId:tenantId }`.
  - **Deploy**: `POST {host}/symphony/restInfo/ajax/deployBpmn`, body `{ id }`.
  - Decoded `bpmnFile` is a plain `<definitions><process>…</definitions>` — the **same format
    `pbModel.js` already parses**. Confirmed by running the un-modified `parseProcess()` against
    it (17 nodes / 20 edges, no crash).
- Live-verified (read-only) that the Keycloak bearer used everywhere else (`getToken()`) is
  accepted by the Symphony `tabulator`/`deployBpmn` endpoints directly — the browser capture used
  cookie auth, but the API accepts Bearer too (user's hunch, confirmed).
- Live-verified the id-changes-on-save claim: re-fetched the same process
  (`B2WA_ml_IFS_passive_trigger`) via the list endpoint and got a **different** `id` than the one
  captured in `save.txt` hours/days earlier, for the identical process `name`. This settled the
  "track by name, not id" requirement beyond doubt.
- Live-verified the detail endpoint (`GET tabulator/id/{id}`) also exposes a `bpmn_description`
  hidden input — not present in the list response — so `description` is fetched alongside the XML
  and echoed back unchanged on save (never silently blanked).

## Phase 1 — corpus-driven BPMN engine extension (the bulk of the work)

The user pointed at `../../sorgenia_workspace/` as a rich real-world LRP corpus. This became the
primary verification method: a harness that runs every real `.bpmn20.xml` file through
`decompose({built_page: xml}) → recompose → comparePayload` and requires **0 diffs**.

**Baseline: 521/983 pass, 462 fail, 0 crashes.** Every failure was a dropped element — never a
parser error — which made this tractable as an iterate-fix-rerun loop.

Fixes applied to `pbModel.js`/`pbProject.js`, in the order found, each re-verified against the
full corpus:

1. **New node/flow-element types** added to `NODE_TAGS`/`PROMOTED_ATTRS`: `intermediateCatchEvent`,
   `intermediateThrowEvent`, `callActivity` (+ its `activiti:in`/`activiti:out` data mappings from
   `extensionElements`), `parallelGateway`, `eventBasedGateway`.
2. **Generalized event-definition parsing** (`parseEventDefinitions`/`buildEventDefinitions`):
   previously only `boundaryEvent`/`endEvent` had bespoke `errorEventDefinition` handling; now any
   event-host tag (start/end/boundary/intermediate-catch/intermediate-throw) carries an array of
   `{type, attrs, timer?}` covering `messageEventDefinition`, `errorEventDefinition`,
   `timerEventDefinition` (+ `timeDuration`/`timeDate`/`timeCycle`), `terminateEventDefinition`,
   `signalEventDefinition`.
3. **Namespace-prefix bug (pre-existing, affects PB too)**: 25 corpus files bind the DD/DI
   namespace to `di:` instead of the usual `omgdi:` (same URI, different alias) — a fully legal
   BPMN/XML namespace choice the parser hardcoded around. `parseDiagram`/`buildDiagram` now
   resolve the real prefix from the `<definitions>` root's `xmlns:*` declarations
   (`diWaypointTag(ns)`) instead of hardcoding `omgdi:waypoint`.
4. **Dropped `<message>`/`<signal>`/`<error>` declarations (pre-existing, silent, affects PB
   too)**: these are declared as **siblings of `<process>`** at the `<definitions>` root (verified
   by direct inspection — never nested inside `<process>`), but the old code's `model.errors`
   handling looked for `<error>` *inside* `<process>` children, where it never actually occurs —
   so it was silently dead code, and message/signal/error declarations were dropped on every
   rebuild with **no diff ever reported**, because `comparePayload`'s `compareProcess` only
   compared the `<process>` subtree. Fixed: `parseProcess` now walks all `<definitions>` children,
   captures `model.messages`/`model.errors`/`model.signals` (+ `model.extraDefs` for anything else
   unrecognized, e.g. `<category>`/`<categoryValue>`, kept as raw passthrough nodes for
   future-proof 0-loss), rebuilt in `buildProcess`. **`normalizeProcessTree` widened** to include
   these declarations in the semantic 0-loss gate — this was a real correctness gap, not just an
   LRP feature gap, since message/error/signal event refs would dangle after any PB or LRP push.
5. **Zero-waypoint edges dropped (pre-existing)**: `geometryMaps` skipped recording an edge's
   waypoints if the array was empty (`e.waypoints?.length` guard), which meant `buildDiagram`
   never re-emitted the (real, if degenerate) `<bpmndi:BPMNEdge>` shape for it at all — losing a
   whole element, not just its geometry.
6. **`incoming`/`outgoing` echo-tag sync (pre-existing)**: some corpus files (evidently hand-edited
   or exported by a less strict tool) omit the redundant `<incoming>`/`<outgoing>` children on a
   node even though the referencing `sequenceFlow` exists — these tags carry zero behavioral
   meaning (Activiti's actual engine reads `sourceRef`/`targetRef` off `sequenceFlow`, never these
   echoes) and our engine always regenerates a complete, correct set. Decided to have `canon()`
   drop `incoming`/`outgoing` from the comparison entirely rather than try to preserve the
   original's (possibly incomplete) count — this is normalization, not data loss.
7. **Empty `<extensionElements/>` on serviceTask**: `parseServiceFields` returned `[]` both for
   "no extensionElements at all" and "extensionElements present but empty", so the empty-but-real
   wrapper was dropped on rebuild. Now returns `undefined` vs `[]` to distinguish, and the build
   side emits the wrapper whenever it's defined (even empty).
8. **Empty/attrs-only `<conditionExpression/>`**: same class of bug — a self-closing
   `<conditionExpression xsi:type="..."/>` (no CDATA body) was being rebuilt with a synthesized
   empty CDATA child, changing its child count. Also found (via `check_second_level.bpmn20.xml`)
   a `<conditionExpression language="${isAlive}" .../>` carrying its real value in a non-standard
   `language` attribute instead of CDATA — previously silently dropped since only `xsi:type` was
   read off this element. Both fixed: condition kids/attrs are now read and rebuilt precisely as
   present, not assumed.
9. **`<group>` BPMN element** (a visual grouping box referencing a `<definitions>`-root
   `categoryValue`, `<group id=... categoryValueRef=.../>`) wasn't modeled at all — dropped
   silently, along with its `bpmndi:BPMNShape`. Added as `model.groups`, parsed/built like
   `textAnnotation`/`association`, included in `buildDiagram`'s shape emission.
10. **Nested `textAnnotation`/`association`/`group` hoisted to root on rebuild**: these were parsed
    correctly wherever found (including nested inside a `subProcess`), but the build side
    unconditionally emitted **all** of them at the `<process>` root regardless of where they
    originally lived — so a nested annotation would relocate to root on every round-trip,
    changing both the parent's and root's child counts. Fixed by tracking `.parent` on these
    (same pattern as edges/nodes) and filtering by parent in `buildFlowChildren`.
11. **Fields with both `activiti:string` and `activiti:expression` children**: the corpus has at
    least one (`B2WA_dl_indemnities.bpmn20.xml`, field `retries`) with both present — the old
    code picked one via `if/else if`, silently dropping the other. Generalized `parseServiceFields`
    to preserve an ordered `parts: [{kind, value}]` list per field instead of a single
    `.string`/`.expression` key, so any number/combination survives.
12. **`lintIncomingEdges` false positive (pbEdit.js, caught during the "make pb * LRP-aware" pass,
    not the corpus harness)**: the rule "only exclusiveGateway may have >1 incoming flows" doesn't
    hold for `parallelGateway`/`eventBasedGateway`, which legitimately join multiple incoming
    flows (61 real occurrences in the corpus, e.g. a parallel-split-then-join pattern). Broadened
    the exemption to `JOIN_CAPABLE_GATEWAYS = {exclusiveGateway, parallelGateway,
    eventBasedGateway}`; the "not both >1 incoming AND >1 outgoing" sub-rule stays scoped to
    `exclusiveGateway` only (parallel/event-based fork-then-join is legitimate).

**Result: 983/983 corpus files round-trip with 0 diffs, 0 errors** (harness prototype lived at
`/tmp/rt.mjs` during the session, not committed — see Verification below for how to reconstruct
it if needed).

Fixes 3–8, 10 are **pre-existing PB engine bugs**, not LRP-specific — they benefit PB round-trip
fidelity too (see Verification: PB regression check).

## Phase 2 — LRP API client and payload adapter

- **`src/agrippa/lib/lrpApi.js`** (new): mirrors `pbApi.js`'s shape. Exports `listLrps`,
  `resolveLrpByName`, `getLrpXml`, `saveLrp`, `deployLrp`, `fetchUpstream` (bundles
  resolve-by-name + detail fetch into one `{row, payload}` result, used by both `pull`'s
  classification step and `pullLrpEntry`/`pushLrpEntry`). `listLrps` supports an `AbortController`
  signal for the interactive live-search UX (mirrors `exportLrp.js`'s pattern).
- **LRP payload adapter**: no structural change needed to `decompose`/`recompose` — an LRP is
  simply wrapped as `{ built_page: xml }` (no `pages`, no `document_id`/`guid`/scalars). Proven
  directly by the corpus harness, which uses exactly this shape.

## Phase 3 — clone/pull/push command handlers

New files mirroring the PB trio, minus page-sync:

- **`cloneLrp.js`**: select by `--name` (exact via `resolveLrpByName`) or interactive server-side
  search (LRPs are searched server-side by name per keystroke, not fetched-all-then-fuzzy-filtered
  like PBs — mirrors `exportLrp.js`'s live-search UX). Destination defaults to the name with a
  `B2WA_` prefix stripped. Registers a workspace entry: `{path, object_type:
  'long_running_process', name, tenant_id, svg, description, checksum_at_pull, version, status}`
  — no `guid`/`document_id`.
- **`pullLrp.js`**: `pullLrpEntry` mirrors `pullPbEntry` — backup current local state, decompose
  upstream, prune orphaned `scripts/*.js`, write, verify. No `pages/` prune (doesn't exist for
  LRPs).
- **`pushLrp.js`**: `pushLrpEntry` mirrors `pushPbEntry` minus the page-sync block — backs up
  upstream XML, **re-resolves the current row by name immediately before saving** (never trusts a
  stored/stale id), calls `saveLrp`. `deploy()` wraps `deployLrp`. **The `saved` PATCH response is
  returned un-interpreted** — not yet verified live whether it echoes a fresh id/version or
  whether `deployBpmn` always wants the pre-save row id; flagged for confirmation before relying
  on it (see Open items).

## Phase 4 — dispatch wiring

- **`clone.js`**: `--lrp` fast path + `Long Running Process` option in the interactive type
  select, routing to `cloneLrp`.
- **`pull.js`**: added `pullLrpEntries` (mirrors `pullPbEntries`), excluded
  `long_running_process` from the generic phase/mfa `pullable` filter, wired into `pull()`.
- **`push.js`**: added `hasLrp` detection + `IMPORTEXPORT_URL` requirement, an `lrpUpstreamMap`
  (fetched via `fetchUpstream`), a classification branch (same
  unchanged/fast-forward/conflict logic as PB, using `remoteChecksumPb(upstream.payload)`), a
  dispatch branch calling `pushLrpEntry`, and `handleDeploy` (mirrors `handlePublish`, reusing the
  existing `--publish`/`--skip-publish` flags — "publish" doubles as "deploy" for LRPs). Workspace
  entries located by **name** for LRP, not `id`/`guid`.
- **`index.js`**: `--lrp` flag added to `clone` only (`pull`/`push` take no object-type flags at
  all in the existing design — they always operate on the whole workspace — so nothing to add
  there beyond the `--publish`/`--skip-publish` description tweaks).

## Phase 5 — `agrippa pb *` editing suite made LRP-aware

Almost-missed: the initial plan-mode draft scoped this out as "optional follow-up, not in scope
now." The user explicitly corrected this — `agrippa pb format/add/rm/connect/disconnect/
set-default/ls/preview/lint` needed to work on cloned LRPs too, since they operate purely on
`structure.yaml` (no network) and are otherwise already node-type-agnostic.

- **`pb.js`**: `resolveProjectPath` → split into `resolveProjectEntry` (returns the full workspace
  entry, not just the path) + a thin `resolveProjectPath` wrapper for existing call sites.
  Broadened the filter to include `long_running_process`, match `--pb <sel>` against `name` when
  `document_id` is absent (confirmed by the user: `--pb <name>` stays the single selector for
  both). `pbAdd` now rejects `--type userTask` on an LRP project with a clear error (LRPs have no
  pages).
- **`pbEdit.js`**: added `SIZE`/`PREFIX` entries for the 5 new node types — sizes verified against
  real corpus geometry, not guessed (`callActivity`/serviceTask-sized 84×84, events 36×36,
  gateways 50×50 — 100% match against measured bounds across the whole corpus). Fixed the
  `lintIncomingEdges` false-positive noted above.
- **`index.js`**: `--pb` option descriptions/placeholder updated to `<document_id_or_name>` across
  all 9 `pb` subcommands; `--type` help text lists the 5 new node types.

## Verification

- **Corpus round-trip**: 983/983 real LRP `.bpmn20.xml` files (from `../../sorgenia_workspace`),
  0 diffs, 0 errors, via `decompose({built_page: xml}) → recompose → comparePayload`.
- **PB regression check** (user-requested, since `pbModel.js`/`pbProject.js` are shared code):
  found every `agrippa.yaml` workspace on the machine (`find ... -iname agrippa.yaml`), extracted
  every `object_type: process_builder` entry's `guid` (14 total, across 6 workspaces: anagrafica,
  voltura-fibra, rimborsi, attiv-ele ×5, cessazioni, sorgenia_workspace ×2), fetched each **live**
  via `getProcess(token, guid)`, ran `decompose → recompose → comparePayload` with the **updated**
  code. **14/14 pass, 0 diffs, 0 errors** — includes wizards using `userTask`/pages (up to 4 pages,
  21 scripts on one). Process builders are unaffected by the LRP changes.
- **Live LRP clone** (read-only): `agrippa clone --lrp --name "B2WA_ml_IFS_passive_trigger"
  --path ...` through the real CLI against the real Symphony API — `Cloned to .../ (4 script(s))`,
  round-trip clean apart from the expected `pages` diff (see below).
- **Live complex-LRP spot checks** (via `lrpApi.js` directly, not the CLI — read-only, no disk
  writes): resolved exact live names for three user-requested processes and ran
  decompose/recompose/compare against the live-fetched XML:
  - `B2WA_ml_IFS_passthrough` — 109 nodes / 130 edges, types incl. `parallelGateway`,
    `intermediateCatchEvent`, `subProcess` — **0 diffs**.
  - `B2WA_SRG_OM_SYM_ORDERITEM` — 153 nodes / 178 edges, types incl. `callActivity`,
    `intermediateCatchEvent`, `parallelGateway` — **0 diffs**.
  - `B2WA_ml_fiber_activation_migration_FW` — 383 nodes / 522 edges, 629KB XML, 117 scripts,
    types incl. `callActivity`, `eventBasedGateway`, `intermediateCatchEvent` — **0 diffs**.
- **`pages: undefined != object` suppressed** for LRPs specifically: `comparePayload` is shared
  with PB (where a real `pages` diff is meaningful), so the filter (`.filter(d =>
  !d.startsWith('pages:'))`) was added at the LRP call sites (`cloneLrp.js`, `pullLrp.js`) rather
  than in the shared `comparePayload`.
- `npx eslint`/`npx prettier --check` clean (0 errors; only pre-existing repo-wide `no-console`
  warnings) across every new/modified file.
- CLI smoke-tested (`agrippa --help`, `agrippa clone --help`, `agrippa pb add --help`) after every
  wiring change to catch import/syntax errors early.

### Open items (not yet done — need explicit go-ahead, these are writes)

- **`pushLrpEntry`/`deployLrp` have never been called against a real LRP.** Specifically unverified:
  - Whether `saveLrp`'s PATCH response contains a fresh id/version, or whether the caller should
    keep using the pre-save `resolveLrpByName` row for the subsequent `deployBpmn` call.
    `pushLrpEntry` currently returns `res.saved` un-interpreted and `push.js` picks
    `res.saved?.id ?? res.newRow.id` for the deploy id — this fallback logic is unverified.
  - Whether `newVersion: false` in the save body actually keeps the process in place (as the field
    name implies) rather than creating a new version/id.
  - Recommend testing this against a disposable/test LRP, not a production one, before relying on
    push/deploy in real workflows.

## Files touched

**New**: `src/agrippa/lib/lrpApi.js`, `src/agrippa/commands/cloneLrp.js`,
`src/agrippa/commands/pullLrp.js`, `src/agrippa/commands/pushLrp.js`.

**Modified**: `src/agrippa/lib/pbModel.js` (bulk of the engine work), `src/agrippa/lib/
pbProject.js` (message/signal/group threading, zero-waypoint fix, LRP payload shape — no
structural change needed beyond that), `src/agrippa/lib/pbEdit.js` (SIZE/PREFIX + lint fix),
`src/agrippa/commands/clone.js`, `src/agrippa/commands/pull.js`, `src/agrippa/commands/push.js`,
`src/agrippa/commands/pb.js`, `src/agrippa/index.js`.

**Reused unchanged**: `pbWorkspace.js`, `checksum.js`, `pbLayout.js`, `pbPreview.js`,
`pbScriptTemplate.js`, the backup-timestamp + `selectEntries` conventions.

## Reference material copied into this task folder

- `payloads/save.txt`, `payloads/deploy.txt` — the user's original browser "copy as fetch"
  captures for the LRP save/deploy calls (source of the API contract in Phase 0). Originals also
  remain at the repo root as `save.txt`/`deploy.txt` (untracked, not moved).
