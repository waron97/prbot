# Planning — `agrippa pb` helper utilities (step 3)

Builds on `process-builder-clone` (decompose/recompose, structure.yaml is the graph)
and `process-builder-push` (dispatch + publish). This step adds **local editing
ergonomics**: an auto-formatter and structural graph helpers.

## Decisions (confirmed with the user)

1. **Helper scope = structural only.** CLI helpers for add / rm / connect / disconnect / ls
   — the ops where raw-YAML editing traps an agent: BPMN id generation, dangling-edge
   cleanup on remove, subProcess nesting, multi-file scaffolding (script/page/manifest),
   round-trip validation. **Content edits** (rename, condition, script body, fields)
   stay raw-YAML — a helper there adds nothing.
2. **Command surface = new `pb` subcommand group.** `agrippa pb format|add|rm|connect|disconnect|ls`.
   Matches the `pb format` syntax in the instructions. Selector resolves a
   `process_builder` workspace entry by `document_id` (`--pb <id>`), or uses the cwd
   project if it holds `.agrippa-pb.json`, else fuzzy-prompts.
3. **New-node geometry = stub + require `format`.** Mutations write correct *size* and a
   placeholder position (and a straight-line waypoint for new edges) so the project stays
   recompose-valid; the agent runs `pb format` to finalize. Clean mutation/geometry split.
   `push` warns if any node still lacks real layout.
4. **Layout engine = elkjs** (`org.eclipse.elk.layered`, `direction=RIGHT`, ortho routing,
   native compound-node hierarchy for subProcess/transaction). Added as a dependency.

## Element sizes (fixed, measured across all fixtures)

| type | W×H |
|---|---|
| startEvent / endEvent / boundaryEvent | 36×36 |
| exclusiveGateway | 50×50 |
| scriptTask / serviceTask / userTask | 84×84 |
| subProcess / transaction | computed from contents (ELK sizes the parent) |
| textAnnotation | computed from label |

Flow line convention (from a real clone): every node centered on a shared y (e.g. y=120);
left→right. ELK layered RIGHT reproduces this.

## Module plan

- `src/agrippa/lib/pbLayout.js` — `autoLayout(structure)` → mutates `layout`/`waypoints`
  on every node/edge (+ annotations/associations) via elkjs. Recurses into containers
  (ELK compound nodes); converts ELK's parent-relative coords to absolute BPMN bounds;
  maps edge sections → waypoint polylines; post-places boundaryEvents on their
  `attachedToRef` task border. Pure (no IO), async.
- `src/agrippa/lib/pbEdit.js` — graph mutation over the parsed structure object:
  `findNode`, `genNodeId`, `genEdgeId`, `addNode`, `removeNode`, `connect`, `disconnect`,
  `listGraph`. Returns file side-effects (scripts/pages to write/delete, manifest patch)
  for the command layer to apply. No IO.
- `src/agrippa/commands/pb.js` — orchestration: resolve project dir, read
  structure.yaml + manifest, dispatch the op, write structure + side-effect files,
  validate (recompose must not throw), print result (new id for add/connect; table for ls).
- `src/agrippa/index.js` — register the `pb` group.
- `src/agrippa/lib/pbProject.js` — export `stringifyStructure` (reuse the flow-style
  layout/waypoints renderer for write-back).

## Agent loop

`pb ls` (discover ids) → `pb add` / `pb connect` (mutate) → `pb format` (geometry) →
`agrippa push` (dispatch). The agent never reads the multi-thousand-line YAML.

## Validation

- Round-trip: after every mutation and after format, `recompose` must succeed and the
  diagram must build (every node has a shape, every edge a waypoint set).
- `format` on the real clone (`ml_cessazioni_point_selection`) and on the 5 fixtures:
  produces a valid, left→right diagram; recompose stays 0-loss at the `<process>` level
  (only geometry changes).
