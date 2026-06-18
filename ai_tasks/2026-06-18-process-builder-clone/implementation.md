# Implementation notes — `agrippa clone --pb`

Running log of what was built and why. See `planning.md` for the agreed design.

## Confirmed live (phase 0)

- `PB_URL = https://sorgenia-test-02.symple.cloud/api/processbuilder/v1` (same host as
  `IMPORTEXPORT_URL`, different service path). `GET /builder/process` → 200, returns 282
  processes (the list endpoint actually returns *full* objects incl. `built_page`/`pages`,
  but we still use `GET /builder/process/<guid>` per spec for the single fetch).
- Auth: the existing Keycloak `getToken()` bearer is accepted as-is. ✔
- Dep added: `fast-xml-parser@^5.9.2` (parse with `preserveOrder` for faithful trees).

## Decisions made during build (refining planning.md)

1. **Geometry (bpmndi) lives in the manifest**, keyed by element id — *not* in `structure.yaml`.
   Rationale: bounds+waypoints for every node/edge would bury the editable logic graph, and
   geometry is not behavior (bar A). It still round-trips. Future `add-node` util assigns
   geometry for new nodes. (User asked to *preserve* coordinates; location is an impl detail.)
2. **0-loss gate = normalized faithful-XML-tree comparison**, independent of our model.
   `normalizeTree(xml)` parses with `preserveOrder`, drops pure-whitespace text nodes, sorts
   attributes, sorts id-bearing sibling elements by id, and sorts `incoming`/`outgoing` sets;
   it does **not** touch CDATA/text content or attribute values. Two wizards are "identical"
   (bar A) iff their normalized trees deep-equal. This catches any dropped attr/element/CDATA,
   even ones our editable model doesn't promote.
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
  (logic `<process>` semantic, diagram verbatim, pages/`process_structure`/scalars deep-equal).
  Largest fixture: `ml_voltura_data_input` — 158 nodes, 199 edges, 42 scripts, 28 service tasks.
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

## Deferred (future tasks, by design)

- **Publishing** the recomposed payload (POST/PATCH to `PB_URL`) — out of scope here.
- **Edit utilities** `add-node` / `remove-node` / `connect-node`, incl. geometry assignment for
  new nodes and patching the (currently verbatim) `<bpmndi>` block when structure changes.
- **`process_structure` regeneration** (replicate the server's `generate_process_steps`) — only
  needed at publish; carried verbatim in the manifest for now.
- **`pull`/`push` symmetry** for `process_builder` workspace entries (clone registers them; the
  pull/push commands don't yet handle this object type).
