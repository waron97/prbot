# Planning — `agrippa clone --pb`

## Goal

Add a `--pb` (process-builder) variant to `agrippa clone`. It downloads a process-builder
wizard from the API, **fully decomposes** it into editable files on disk, and ships a
**recompose** utility that rebuilds the original payload from those files. Actual publishing
is a later task; this task delivers clone + recompose + a round-trip validation harness.

## Decisions locked with the user

1. **Strategy: full decompose + rebuild.** The BPMN is parsed into an authoritative,
   editable model (`structure.yaml` + `scripts/` + `pages/`). On recompose we *regenerate*
   the BPMN XML from those files — we do **not** keep the original XML as a hidden skeleton.
2. **Everything is editable from the filesystem** — every block (node) and every edge of the
   wizard. Future agrippa utilities (`add-node`, `remove-node`, `connect-node`) will make
   editing ergonomic, but the files alone are the source of truth and can be hand-edited.
3. **0-loss bar = A (semantic / behavioral equivalence).** The rebuilt wizard must *behave*
   identically: same nodes, same edges, same scripts, same conditions, same service-task
   params, same page definitions. Byte-identical XML is **not** required — attribute order,
   namespace prefixes, whitespace, and self-closing-vs-empty-tag differences are acceptable.
   Validation is done by parsing both payloads into a normalized model and deep-comparing
   (see "Validation harness").

## What a wizard actually is (data model)

`GET {PB_URL}/builder/process` → list of `{guid, document_id, process_name, ...}`.
`GET {PB_URL}/builder/process/<guid>` → full payload. Top-level fields:

| Field | Role | Authoritative? |
|---|---|---|
| `document_id` | technical name (BPMN `processKey`) | scalar |
| `process_name` | human name | scalar |
| `version`, `icon`, `short_description`, `status`, `active`, `is_linear`, `execute_save`, `progressbar_enabled`, `start_date`, `end_date`, `favorite` | metadata flags | scalar |
| `built_page` | **full Activiti/BPMN 2.0 XML string** — the whole graph | **source of truth** |
| `process_structure` | object w/ `processSteps[]` (step nav summary) | **derived** server-side from `built_page` |
| `pages[]` | one wrapper per `userTask`, holds the UI form (`page.page_builder`) | stored separately, **not** regenerated from XML |
| `guid`, `created_*`, `updated_*`, `modified_by`, `sequence_data`, `owner_group` | audit | server-managed |

Confirmed by reading the backend (`b2w-process-builder`):
`built_page` is stored verbatim and is authoritative; `process_structure` is regenerated via
`generate_process_steps(built_page)` on every save; `page_builder` is stored as-is per page.

### BPMN element inventory (must all be modeled — union across the 5 samples)

- `definitions` — fixed namespaces + `targetNamespace`
- `process` — `id`, `name`, `isExecutable`, `<documentation>`
- `startEvent`, `endEvent` (+ `<errorEventDefinition errorRef>`), top-level `<error id errorCode>`
- `scriptTask` — `id`, `name`, `scriptFormat`, `activiti:async|exclusive|autoStoreVariables`, body in `<script><![CDATA[…]]></script>`
- `serviceTask` — `id`, `name`, `activiti:class`, async/exclusive, `extensionElements > activiti:field[name] > (activiti:string CDATA | activiti:expression text)`
- `userTask` — `id`, `name`, `activiti:formKey`
- `exclusiveGateway` — `id`, `name`, optional `default`
- `sequenceFlow` — `id`, `sourceRef`, `targetRef`, optional `<conditionExpression xsi:type="tFormalExpression"><![CDATA[js]]></conditionExpression>`
- `subProcess` — nested flow elements + `multiInstanceLoopCharacteristics` (`loopCardinality`, `completionCondition`)
- `boundaryEvent` — `attachedToRef`, `cancelActivity`, `errorEventDefinition`
- `incoming`/`outgoing` — **derived** from edges, not stored
- `bpmndi:BPMNDiagram > BPMNPlane > (BPMNShape{bpmnElement, omgdc:Bounds x/y/w/h, isExpanded?, BPMNLabel} | BPMNEdge{bpmnElement, omgdi:waypoint*, BPMNLabel})` — **diagram geometry**

### Critical naming relationships (verified in samples)

```
userTask.id          == page.name == page._id.stepkey   e.g. "UserTask_dclfc6y"
userTask.formKey     == processSteps[].stepKey           e.g. "select_pod"   (human-ish step id)
page._id.processkey  == document_id
```

So a page links to its userTask **by userTask id**, not by formKey. Page **filenames** will use
the friendlier `formKey`, with the id mapping recorded in the manifest.

### Counts observed (5 samples)

scriptTasks 5–42, serviceTasks 3–28, userTasks 2–5. `scriptTask:<script>` is strictly 1:1.
scriptTask `name`s are *mostly* unique but **not guaranteed** (one collision in a sample) →
filenames need an ordering prefix + manifest id-map, not name alone. `]]>` also appears inside
`conditionExpression` and `activiti:string` → scripts must be extracted by walking
`scriptTask` elements, never by a global CDATA regex.

## On-disk layout

```
<dest>/                         # destination dir, default = document_id
  process.yaml                  # user-facing scalars + identity
  structure.yaml                # AUTHORITATIVE graph: process attrs, nodes[], edges[], errors[]
  scripts/
    0010_initialize_variables.js   # one file per scriptTask <script> body
    0020_set_wizard_status.js
    ...
  pages/
    select_pod.yml              # one file per userTask: the `page` object (columns, page_builder, entities)
    select_invoice.yml
    ...
  .agrippa-pb.json              # machine manifest (NOT hand-edited): see below
```

### `process.yaml` (editable scalars)
```yaml
document_id: ml_review_billing
process_name: ML - Rettifica di fatturazione
version: 1
icon: pricing
short_description: Rettifica di Fatturazione
status: published
active: true
is_linear: false
execute_save: true
progressbar_enabled: true
start_date: null
end_date: null
```

### `structure.yaml` (editable graph — the heart)

> Final shape (see implementation.md "Revision 1"): **edges nest under their source node**,
> **geometry `{x,y,width,height}` + waypoints live inline on nodes/edges**, and **subProcess
> children nest recursively**. `source` is implicit (the containing node). Internally the model
> is flat; `pbProject` nests on decompose / flattens on recompose.

```yaml
process:
  id: PB_PROCESS_NAME_VALUE        # the <process id> attr value as-is
  name: PB_PROCESS_NAME_VALUE
  isExecutable: "true"
  documentation: Check Init
errors: []
nodes:
  - id: ScriptTask_0m0bvsq
    type: scriptTask
    name: Init Variables
    attrs: { scriptFormat: javascript, activiti:async: "false", activiti:exclusive: "false" }
    script: scripts/0010_init-variables.js
    layout: { x: 588, y: 78, width: 84, height: 84 }
    edges:                                   # outgoing only; source implicit
      - id: SequenceFlow_0ba03og
        target: ExclusiveGateway_0rfhfmz
        waypoints: [ [ 672, 120 ], [ 725, 120 ] ]
  - id: ServiceTask_1b93zug
    type: serviceTask
    name: Template
    class: com.symphony.action.TemplateDelegate
    fields:                                  # order kept; string vs expression distinguished
      - { name: method, string: "GET" }
      - { name: value }                      # empty <activiti:field/> -> no value key
    layout: { ... }
    edges: [ ... ]
  - id: SubProcess_1hgsdba
    type: subProcess
    multiInstance:
      attrs: { isSequential: "true" }
      loopCardinality: { value: "${numPagesToFetch}", attrs: { xsi:type: tFormalExpression } }
      completionCondition: { value: "${nrOfCompletedInstances == numPagesToFetch}", attrs: { ... } }
    layout: { ... }
    edges: [ ... ]                           # edges leaving the subprocess
    nodes:                                   # recursive: inner blocks + their edges
      - id: ScriptTask_07dhbok
        type: scriptTask
        name: Prep fetch next
        layout: { ... }
        edges: [ { id: SequenceFlow_1qaj0jg, target: ServiceTask_12j7ob7 } ]
      # ServiceTask_12j7ob7 (Fetch Next Page), ScriptTask_0vayzkg (Parse next page), ...
annotations: []
associations: []
```

Notes:
- `incoming`/`outgoing` are reconstructed from edges — never stored (avoids a second source of truth).
- Conditional edges carry `condition: "${...}"` (the JS condition). `default` gateway flow and
  any rare attrs are preserved via the generic `attrs` bag.
- `layout`/`waypoints` round-trip the diagram and feed the future auto-formatter. The manifest
  keeps the *full* parsed diagram (incl. annotation/association shapes, labels, plane ids) as the
  authoritative fallback; structure.yaml geometry overrides it on recompose.

### `pages/<formKey>.yml` (editable UI form)
The `page` object verbatim as YAML (`_id`, `columns`, `page_name`, `entities`, `page_builder[]`).
`page_builder` elements (`Title`/`Section`/`Field`/`Button`/`WebComponent`) keep all of
`field_info`, `validation` (incl. `complex` conditional rules), `button_info`, `styles`.
Wrapper audit fields (`guid`, `process_guid`, `sequence_data`, `created_*`) go to the manifest,
not the page file.

### `.agrippa-pb.json` (manifest — machine-managed, not the edit surface)
Holds everything needed to rebuild the *exact* payload for the round-trip test and to map
files back to ids — i.e. the bits that aren't wizard *design*:
```json
{
  "guid": "…", "document_id": "ml_review_billing", "process_name": "…", "version": 1,
  "audit": { "created_by": "…", "created_date": "…", "updated_date": "…", "sequence_data": "…", "owner_group": null },
  "scripts": { "ScriptTask_0jxkwfv": "scripts/0010_initialize_variables.js", ... },
  "pages":   { "UserTask_dclfc6y": { "file": "pages/select_pod.yml", "guid": "…", "process_guid": "…", "sequence_data": "…", "audit": {…} } },
  "checksum_at_pull": "<sha of normalized model>"
}
```

## Decompose algorithm (clone)

1. Resolve `PB_URL` + token (`getToken()`); `GET /builder/process` for the list.
2. Pick the process: by `--name <document_id>` arg (auto-select), else interactive fuzzy search
   over `process_name` / `document_id` (reuse `fuzzyMatch`, same UX as existing clone).
3. Prompt for destination dir (`--path` to skip), default = `document_id`.
4. `GET /builder/process/<guid>` → full payload.
5. Split scalars → `process.yaml`; audit + maps → manifest.
6. Parse `built_page` XML (fast-xml-parser, CDATA + attribute preservation) into the node/edge
   model. Walk `scriptTask` elements: write each `<script>` body to `scripts/NNNN_<slug>.js`
   (NNNN = document order × 10, slug from `name`); record id→file in manifest; replace the body
   in the model with a `script:` file ref. Map `bpmndi` geometry onto nodes/edges.
7. For each `pages[]` entry, write `page` → `pages/<formKey>.yml`; record wrapper audit in manifest.
8. Emit `structure.yaml`.
9. Register the process in `agrippa.yaml` workspace (`object_type: "process_builder"`,
   `path`, `guid`, `document_id`, `name`, `checksum_at_pull`) for later `pull`/`push` symmetry.

## Recompose algorithm (utility, used by validation now; by publish later)

1. Read `process.yaml`, `structure.yaml`, all `scripts/*.js`, all `pages/*.yml`, manifest.
2. Rebuild BPMN XML from the model: emit `definitions` (fixed namespaces) → `process` → nodes
   (re-injecting script bodies into `<script><![CDATA[…]]></script>`, service-task fields,
   gateways, user-tasks, events, subprocesses) → reconstructed `incoming`/`outgoing` from edges
   → `sequenceFlow`s with conditions → `bpmndi` from layout/waypoints.
3. Reassemble `pages[]` wrappers (page object + manifest audit).
4. **Regenerate `process_structure.processSteps`** from the userTask order (mirror the server's
   `generate_process_steps`) — or carry it in the manifest; decide during impl (server
   regenerates anyway, so this only matters for the local round-trip check).
5. Assemble the full payload object.

## Validation harness (proves 0-loss = bar A)

A dev script (e.g. `npm run pb:roundtrip <sample.json>` or a hidden `agrippa clone --pb --verify`)
that, for each of the 5 sample payloads:

1. decompose payload → temp dir (files);
2. recompose temp dir → rebuilt payload;
3. normalize **both** payloads and assert deep-equal, where `normalize`:
   - parses `built_page` of each into the canonical node/edge model (so XML formatting drift is
     erased) and compares the models;
   - compares scripts as exact text (after `.trim()`), per scriptTask id;
   - compares each `page` object deep-equal (JSON semantics — key order irrelevant);
   - compares the scalar fields;
   - ignores purely server-managed/derived fields not in scope (documented explicitly, no
     silent drops — anything ignored is logged).

Run it against all 5 fixtures in the task folder; the harness fails loudly listing any
node/edge/script/page/field that differs. This is the acceptance gate for the task.

## CLI / code changes

- `src/agrippa/index.js` — add `--pb` (+ `--name`, `--path`) to the `clone` command.
- `src/agrippa/commands/clone.js` — branch to a new `clonePb()` when `--pb`.
- `src/agrippa/commands/clonePb.js` — orchestration (decompose).
- `src/agrippa/lib/pbApi.js` — `listProcesses()`, `getProcess(guid)` against `PB_URL`.
- `src/agrippa/lib/pbModel.js` — BPMN ⇄ model (decompose/recompose), the core.
- `src/agrippa/lib/pbWorkspace.js` — file layout read/write (structure/process/pages/scripts/manifest).
- `src/agrippa/commands/pbVerify.js` (or a `scripts/` dev tool) — the round-trip harness.
- `package.json` — add `fast-xml-parser`; reuse existing `yaml`, `slugify`.
- Config: new `PB_URL` env (base e.g. `https://sorgenia-test-02.symple.cloud/api/processbuilder/v1`);
  token via existing `getToken()`. Add to `prbot init` prompts + `loadEffectiveEnv` key list.

## Open questions / risks

- **`PB_URL` exact base + auth**: confirm base path (`…/api/processbuilder/v1`) and that the
  import-export bearer (`getToken()`) is accepted as-is. Will verify live against the listed
  `document_id`s.
- **`subProcess` nesting + `boundaryEvent`** add real parsing complexity (only voltura uses them).
  The model handles them via `parent`/`attachedToRef`; will harden against these fixtures.
- **`process_structure` regeneration**: replicate server logic vs. carry verbatim in manifest.
  Leaning verbatim-in-manifest for a tight round-trip now, replicate later for publish.
- **Geometry for hand-added nodes**: future `add-node` needs an auto-layout fallback; out of
  scope here but the model leaves room (`layout` optional).

## Phases

1. `pbApi` + list/select/destination UX; dump raw payload to confirm `PB_URL`/auth live.
2. `pbModel` parse (BPMN → model) + decompose writers; clone produces the file tree.
3. `pbModel` serialize (model → BPMN) + recompose.
4. Validation harness; iterate until all 5 fixtures pass deep-equal.
5. Wire into `agrippa.yaml` workspace tracking; docs in `implementation.md`.
