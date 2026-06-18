# Implementation notes — `agrippa clone --pb`

Running log of what was built and why. See `planning.md` for the agreed design.

> **Reading order:** this file is chronological. "Decisions made during build" captures the
> *initial* choices; several were later reversed in Revisions 1–3. The **Current design**
> section immediately below is the authoritative end state — trust it where an early section
> conflicts (conflicts are flagged inline with "superseded").

## Current design (authoritative end state)

`agrippa clone --pb [--name <document_id>] [--path <dir>]` downloads a process-builder wizard
and decomposes it into editable local files; `recompose` rebuilds the payload. Publishing is a
later task.

**0-loss bar = A (behavioral / semantic), confirmed with the user.** The rebuilt wizard must
*behave* identically; byte-identical XML is explicitly **not** required. Validated by:
`compareProcess` (normalized `<process>` tree — whitespace/attr-order/sibling-order-insensitive,
CDATA + attr values exact) + `compareDiagram` (geometry only) + deep-equal of `pages`,
`process_structure`, and scalars.

**Files are the single source of truth** (core agrippa principle — never reference prior/remote
state to regenerate):

```
<dir>/
  process.yaml      editable scalar overlay (identity + flags)  — the "envelope"
  structure.yaml    THE graph: nodes hold their own outgoing edges + nested children
                    (subProcess/transaction), inline geometry (layout/waypoints), scripts by ref
  scripts/NNNN_*.js one scriptTask body each, byte-exact (doc order ×10)
  pages/<formKey>.yml one userTask page object each (YAML)
  .agrippa-pb.json  manifest: scalars/audit + ns + process_structure + id<->file maps.
                    Does NOT store the diagram (regenerated from structure.yaml).
```

- **process.yaml vs structure.yaml:** envelope (identity/flags, top-level scalars) vs the graph
  (`built_page` decomposed). Split kept per user request (different authority + edit cadence).
- **Edges** nest under their source node (`source` implicit). `subProcess`/`transaction`
  children nest recursively (`CONTAINER_TAGS`). Internally the model is flat; pbProject
  nests/flattens.
- **Diagram** is regenerated entirely from structure.yaml geometry (node `layout`, edge
  `waypoints`, `expanded`; annotations/associations carry their own). The manifest is never
  read back for the diagram → structural edits drive the diagram, nothing goes stale. DI ids
  derived (`<id>_di`); labels auto-placed by the renderer.

## Confirmed live (phase 0)

- `PB_URL = https://sorgenia-test-02.symple.cloud/api/processbuilder/v1` (same host as
  `IMPORTEXPORT_URL`, different service path). `GET /builder/process` → 200, returns 282
  processes (the list endpoint actually returns *full* objects incl. `built_page`/`pages`,
  but we still use `GET /builder/process/<guid>` per spec for the single fetch).
- Auth: the existing Keycloak `getToken()` bearer is accepted as-is. ✔
- Dep added: `fast-xml-parser@^5.9.2` (parse with `preserveOrder` for faithful trees).

## Decisions made during build (refining planning.md)

1. ~~**Geometry (bpmndi) lives in the manifest**, keyed by element id — *not* in
   `structure.yaml`.~~ **SUPERSEDED (Rev 1 → Rev 3):** geometry now lives inline in
   structure.yaml and the diagram is regenerated from it; the manifest no longer stores the
   diagram at all.
2. **0-loss gate = normalized comparison**, independent of our model. *(Refined in Rev 3:)*
   `compareProcess` canonicalizes the `<process>` tree (drop pure-whitespace text, sort
   attributes, sort id-bearing siblings by key, sort `incoming`/`outgoing`; CDATA + attr values
   compared exact) — catches any dropped attr/element/CDATA. `compareDiagram` compares the
   diagram by *geometry only* (per-`bpmnElement` bounds + `isExpanded`, ordered waypoints),
   ignoring derived DI ids and labels.
3. **Script bodies are preserved byte-exact** (no trim) on extract and re-wrap, so an untouched
   clone round-trips exactly. (`writeCodeFile` trims — not used for scripts.)
4. **Model is generic-with-promotion**: each node keeps friendly fields (name, formKey, class,
   fields, script-ref, multiInstance, errorEventDefinition) plus a catch-all `attrs` bag for
   any non-promoted attribute, so rare attrs (`@_default` on tasks, etc.) survive. Serializer
   is generic over type + attrs + known child shapes, and recurses into `subProcess`.
5. **`process_structure` carried verbatim in the manifest** for the round-trip now; server
   regenerates it on publish anyway. Replicating `generate_process_steps` is deferred.
6. **Script numbering = document order ×10** (`0010_`, `0020_`…). Document order ≠ flow order
   (the BPMN lists nodes unordered) but it is deterministic; manifest maps file ↔ scriptTask id.

## Element inventory modeled (union of 5 fixtures)

definitions(ns + targetNamespace) · process(id,name,isExecutable,documentation) ·
startEvent · endEvent(+errorEventDefinition) · error(id,name) · scriptTask(+script CDATA) ·
serviceTask(activiti:class + extensionElements/activiti:field[string|expression]) ·
userTask(formKey) · exclusiveGateway(default) · sequenceFlow(source,target,name,
conditionExpression CDATA, documentation) · subProcess(nested flow + multiInstance) ·
boundaryEvent(attachedToRef,+errorEventDefinition) · multiInstanceLoopCharacteristics ·
textAnnotation · association · bpmndi diagram (shapes/bounds, edges/waypoints, labels).

## Files added / changed

- `src/agrippa/lib/pbModel.js` — BPMN `<process>` ⇄ graph model + the normalize/compare gate.
- `src/agrippa/lib/pbProject.js` — payload ⇄ decomposed file map; `verifyRoundTrip`/`comparePayload`.
- `src/agrippa/lib/pbWorkspace.js` — disk IO (`writeProject`, `projectReader`).
- `src/agrippa/lib/pbApi.js` — `listProcesses`, `getProcess` against `PB_URL`.
- `src/agrippa/commands/clonePb.js` — orchestration; verifies 0-loss from disk after writing.
- `src/agrippa/commands/clone.js` — delegates to `clonePb` when `--pb`.
- `src/agrippa/index.js` — `clone` gains `--pb` / `--name`.
- `src/agrippa/lib/config.js` — `PB_URL` added to the agrippa overlay keys.
- `src/commands/init.js` — `prbot init` now prompts for `PB_URL`.
- `package.json` — `fast-xml-parser@^5.9.2`.

## Build findings (things that bit, and the fix)

- **`format:true` corrupts CDATA.** The XML builder injects indentation *inside* `<script>`
  CDATA, mangling JS bodies. Fixed by building with `format:false`; `built_page` is compact
  (it is machine-reassembled, never hand-edited). CDATA child shape for the builder must be
  exactly `{ __cdata: [{ '#text': body }] }` — no sibling `#text` key.
- **`multiInstanceLoopCharacteristics`** children (`loopCardinality`/`completionCondition`)
  carry `xsi:type` attrs + text; first pass dropped the attrs. Now stored as `{value, attrs}`.
- **`conditionExpression`, `activiti:string`, and `completionCondition` all use CDATA** —
  scripts are therefore extracted by walking `scriptTask` elements only, never a CDATA regex.
- **`fast-xml-parser`'s `XMLBuilder` is marked `@deprecated`** (suggests the separate
  `fast-xml-builder` pkg) but works in 5.9.2; not worth a second dependency. Left a code note.
- Script-name uniqueness isn't guaranteed → filenames are `NNNN_<slug>` (doc order ×10) with
  the id↔file map in the manifest; collisions get a `_` suffix.

## Validation — all green

- **Offline:** decompose → recompose → `comparePayload` deep-equal on all 5 task fixtures
  (logic `<process>` semantic, diagram by geometry, pages/`process_structure`/scalars deep-equal).
  Largest fixture: `ml_voltura_data_input` — 158 nodes, 199 edges, 42 scripts, 28 service tasks.
  *(This section reflects phase 0–5; see Revisions 1–3 for the final representation.)*
- **Live:** `listProcesses` → 282 wizards; `getProcess` → decompose → write to disk → read back
  → recompose → 0-loss confirmed for `ml_voltura_data_input`.
- **Command:** `agrippa clone --pb --name ml_review_billing --path w` writes process.yaml,
  structure.yaml, 18 scripts, 5 pages, manifest; auto-verifies from disk and prints
  "Round-trip verified … (0 information loss)"; registers a `process_builder` workspace entry.

### How to re-check

```bash
# offline fixture round-trip (no network)
node -e "import('./src/agrippa/lib/pbProject.js').then(async m=>{const fs=await import('fs');\
const d='ai_tasks/2026-06-18-process-builder-clone/sample_wizard_api_responses';\
for(const f of fs.readdirSync(d)){if(!f.endsWith('.json'))continue;\
const p=JSON.parse(fs.readFileSync(d+'/'+f));const r=m.verifyRoundTrip(p);\
console.log((r.length?'FAIL ':'ok   ')+f, r.slice(0,1))}})"

# live clone (needs PB_URL + agrippa.yaml in CWD)
agrippa clone --pb --name <document_id> --path <dir>
```

## Status

- [x] phase 1 — pbApi + clone UX (`--pb`, `--name`, fuzzy select, dest prompt)
- [x] phase 2 — pbModel parse + decompose writers
- [x] phase 3 — pbModel serialize + recompose
- [x] phase 4 — round-trip harness green on all 5 fixtures (and live)
- [x] phase 5 — workspace tracking + docs

## Revision 1 — representation changes (post first commit)

Per user feedback, the graph representation changed (still 0-loss, all 5 fixtures + live green):

1. **Edges are nested under their source node**, not a top-level `edges:` array. Each node
   carries `edges: [{id, target, condition?, name?, waypoints}]`; `source` is implicit (the
   containing node). Internally the model stays flat (`buildProcess` unchanged); `pbProject`
   nests on decompose and flattens on recompose (`nestNodes`/`flattenNodes`).
2. **Diagram geometry is decomposed into structure.yaml**, not kept as a verbatim blob. Each
   node gets `layout: {x, y, width, height}`; each edge gets `waypoints: [[x,y],...]` (rendered
   inline via a flow-style YAML pass). This sets up the future auto-formatter. The manifest
   still holds the *full* parsed diagram (incl. annotation/association shapes, labels, plane
   ids) as the authoritative fallback; structure.yaml layout/waypoints **override** it on
   recompose (same overlay pattern as process.yaml). `pbModel` now parses/builds `<bpmndi>`
   structurally (`parseDiagram`/`buildDiagramXml`) and compares it semantically
   (`compareDiagram`: sort shapes/edges by bpmnElement, coords→Number, waypoint order kept).
3. **Embedded subProcess children nest recursively**: a `subProcess` node holds its own
   `nodes:` (each with its own `edges:`), mirroring the BPMN scope. Verified on
   `ml_voltura_preliminary_checks` (`SubProcess_1hgsdba`: SP Start → Prep fetch next → Fetch
   Next Page → Parse next page → EG Err → End), `multiInstanceLoopCharacteristics` preserved.

## Revision 2 — `transaction` block type

A full live sweep over all 282 wizards (decompose → write to disk → recompose → compare)
surfaced constructs absent from the 5 example fixtures. Added support for **`transaction`**
(Activiti's transactional subprocess) by modeling it exactly like `subProcess`: a `CONTAINER_TAGS`
set `{subProcess, transaction}` now drives parse-recursion, multiInstance parsing, nested-node
serialization, and rebuild. Fixed `in_order_muse` (its `transaction` block — and the sequence
flow leaving it — were being dropped). Sweep: **270/282 round-trip 0-loss**.

### Known unsupported constructs (intentionally not handled)

The remaining 12 failing wizards are incomplete/never-finished, ported from an old system, or
empty shells — confirmed not worth supporting. Listed here so the gap is explicit, not silent:

| construct | wizards | status |
|---|---|---|
| `built_page = null` (empty shell) | ml_gas_activation_charges, PB_SRG_OM_TASK_VC | draft |
| `parallelGateway` | PB_SRG_OM_TASK_ORDERITEM_CCQ, ...PRECHECK | published / modified |
| `callActivity` (+activiti:in/out) | in_order_muse_ver_Two | published |
| `intermediateCatchEvent` (+timer/message defs) | ml_modify_iva_rate_long_running_process | draft |
| `activiti:field` with both string+expression | dl_indemnities, Workshop | published / draft |
| `errorEventDefinition` extra @id/child | voltura_new, PB_SRG_OM_ACTION_OI_SOSPENDI, ForceCreditCheck(OLD), ml_short_prescription_to_delete | published / modified |

If any becomes relevant, each is a small targeted add (most mirror an existing type); a generic
"preserve unknown elements verbatim in the manifest" pass would cover all at once.

## Revision 3 — diagram regenerated from structure.yaml (no manifest reference)

Earlier the manifest held the full parsed diagram and recompose used it as the base, with
structure.yaml only *overriding* geometry. That made the manifest a hidden second source of
truth that would go stale on structural edits (add a node → no shape; delete a node → orphan
shape). Per the agrippa principle that local files are authoritative, the diagram is now
**regenerated purely from structure.yaml**:

- `structure.yaml` carries all geometry: node `layout {x,y,width,height}` (+ `expanded` for
  subprocess shapes), edge `waypoints`, and annotations/associations carry their own
  `layout`/`waypoints` too.
- The manifest **no longer stores the diagram at all** (`buildDiagram(model, geo)` builds
  `<bpmndi>` from the structure graph + geometry; DI element ids are derived as `<id>_di`).
- BPMNLabel boxes and the original (arbitrary) DI ids are **not** preserved — renderers
  auto-place labels, and the ids carry no behavior. `compareDiagram` now compares *geometry
  only* (per-bpmnElement bounds + isExpanded, ordered waypoints), ignoring ids/labels.

Full sweep after the change: **271/283 round-trip 0-loss**, and crucially **zero diagram-level
failures** — every remaining failure is a `<process>`-level unsupported construct (the known
dead/incomplete set). Trade-off accepted by the user: if a regenerated diagram ever displeases
the designer, handle it then; referencing prior state contradicts agrippa-based development.

## Deferred (future tasks, by design)

- **Publishing** the recomposed payload (POST/PATCH to `PB_URL`) — out of scope here.
- **Edit utilities** `add-node` / `remove-node` / `connect-node`. The diagram already regenerates
  from structure.yaml, so these mainly need to assign sensible default geometry to new nodes
  (an auto-formatter); removed nodes drop from the diagram automatically.
- **`process_structure` regeneration** (replicate the server's `generate_process_steps`) — only
  needed at publish; carried verbatim in the manifest for now.
- **`pull`/`push` symmetry** for `process_builder` workspace entries (clone registers them; the
  pull/push commands don't yet handle this object type).

## Decision log (what was discussed with the user)

Chronological record of the choices made in conversation, so the "why" is preserved:

1. **0-loss bar — A vs B.** Offered: (A) behavioral equivalence, formatting drift in the rebuilt
   XML is fine; (B) byte-identical XML. User chose **A**. All comparison/validation is built to
   bar A. Byte-identical BPMN re-serialization was deemed infeasible (attr order, DI layout,
   whitespace) and unnecessary.

2. **Representation strategy.** Offered: preserve-BPMN-verbatim-skeleton + extract editable
   views, vs **full decompose + rebuild**. User chose **full decompose + rebuild**, and required
   that *every* block and edge be editable from the filesystem. Future agrippa utilities
   (`add-node` / `remove-node` / `connect-node`) will make editing ergonomic, but the files
   alone are authoritative.

3. **process.yaml vs structure.yaml.** Clarified the split: process.yaml = the "envelope"
   (identity + flags, the top-level scalars beside `built_page`); structure.yaml = the graph
   (the decomposed `built_page`). User confirmed: **keep them split** (different authority,
   different edit cadence, clean diffs).

4. **Edges modeled under their source block.** User: edges are connections that belong *to* the
   starting block — nest them under the source node (`source` implicit), not a flat top-level
   list. Done (Rev 1).

5. **Diagram geometry in structure.yaml.** User wants at least `{x,y,width,height}` encoded in
   structure.yaml because an auto-formatter for the diagram is planned. Done (Rev 1), then
   hardened (Rev 3).

6. **Embedded subprocess.** User asked specifically how `transaction`/subProcess inner blocks
   (e.g. "Prep fetch next" … "Parse next page") are handled → recursive nesting under the
   container's own `nodes:` (Rev 1/2).

7. **Manifest must not be referenced when regenerating the diagram.** User: "referencing current
   state is contrary to the objective of agrippa-based development." Chose option **B** — derive
   DI ids, drop labels, structure.yaml is the sole source; accepted the risk ("if it breaks,
   we'll handle it then"). Done (Rev 3).

8. **Failing live wizards — triage.** A full 282/283 sweep found ~13 wizards failing on
   constructs outside the 5 examples. User reviewed the list and judged them **incomplete /
   never-worked-on / ported from an old system → no action warranted**, *except*:

9. **`transaction` is a genuine missed block type** (not in the examples). User asked to handle
   it; done (Rev 2). The rest remain intentionally unsupported (table in Rev 2).

10. **Clone path suggestion keeps underscores.** The default destination path must use the
    `document_id` verbatim (e.g. `ml_review_billing`), not a slug that strips underscores. Fixed.

### Known sharp edge (left as-is per #8)

`agrippa clone --pb` **throws** on the 2 empty-draft wizards whose `built_page` is `null`
(`ml_gas_activation_charges`, `PB_SRG_OM_TASK_VC`) instead of skipping gracefully. A ~3-line
guard would make it warn+skip; not added per the user's "no action" call on dead wizards.

### Commits

- `1293f29` — initial `agrippa clone --pb` (flat representation: top-level edges, verbatim diagram).
- `5af0dbc` — nested edges, inline geometry, diagram regenerated from structure.yaml,
  `transaction` support, `<documentation>` on nodes, underscore-preserving path default.
