# agrippa pb — agent guide to editing process-builder wizards

This document is for an **AI agent** asked to add, remove, or reconnect blocks in a
Sorgenia process-builder wizard. Unlike phases/MFAs (which you only need to *know
about*), for wizards you are expected to **drive the `agrippa pb` commands**.

Use the commands for **structural** changes — they hide BPMN id generation, the
nested-YAML graph, dangling-edge cleanup, and the script/page/manifest bookkeeping
you would otherwise get wrong by hand. Edit the YAML directly only for **content**
(see [What to edit by hand](#what-to-edit-by-hand)).

---

## Mental model

A wizard lives upstream as one BPMN payload. `agrippa clone --pb` **decomposes** it
into editable files; `agrippa push` recomposes and uploads. The local files are the
single source of truth — you never reference upstream state to rebuild.

Your loop is always:

```
agrippa pb ls            # discover node/edge ids
agrippa pb add / rm / connect / disconnect   # change the graph
agrippa pb format        # assign geometry (REQUIRED after structural edits)
agrippa push             # upload (saves as draft; --publish to go live)
```

**Always run `pb format` before `push`** after any `add`/`connect`. New nodes/edges
get only stub geometry; `format` lays them out. Skipping it produces a broken diagram.

Every `pb` command targets **one** wizard, resolved by `--pb <document_id>` (preferred
for non-interactive/agent use), single-entry auto-select, or a fuzzy prompt. Always
pass `--pb <document_id>` so you never hit an interactive prompt.

---

## Decomposed project layout

```
<wizard-dir>/
  process.yaml      identity + top-level flags (envelope)
  structure.yaml    THE graph: nodes hold their outgoing `edges` and nested
                    `nodes` (for subProcess/transaction); inline geometry
  scripts/NNNN_*.js one scriptTask body each (byte-exact)
  pages/<formKey>.yml one userTask page object each
  .agrippa-pb.json  manifest: scalars, namespaces, id↔file maps (do not hand-edit)
```

`structure.yaml` is large and nested. **Do not read it to find ids** — use `pb ls`.

A node looks like:

```yaml
- id: ScriptTask_0mmmti4
  type: scriptTask
  name: Init
  script: scripts/0010_init.js      # ref to the body file
  layout: { x: -462, y: 78, width: 84, height: 84 }
  edges:                            # OUTGOING flows belong to the source node
    - id: SequenceFlow_1lso8x0
      target: ExclusiveGateway_1lghfov
      waypoints: [[-378, 120], [-345, 120]]
```

Node types: `startEvent`, `endEvent`, `boundaryEvent`, `exclusiveGateway`,
`scriptTask`, `serviceTask`, `userTask`, `subProcess`, `transaction`.

---

## Commands

### `pb ls` — discover ids

```bash
agrippa pb ls --pb <document_id>
```

Flat list of every node with its id, type, name, parent (if nested), and outgoing
edges. **Start here** to find the ids you need for the other commands. Example:

```
ScriptTask_0mmmti4  (scriptTask)  "Init"
    → ExclusiveGateway_1lghfov  (SequenceFlow_1lso8x0)
ExclusiveGateway_1lghfov  (exclusiveGateway)  "eg err"
    → EndEvent_err  (SequenceFlow_a)  [default]
    → ScriptTask_next  (SequenceFlow_b)  if ${isAlive}
```

`[default]` marks a gateway's default flow; `if …` shows a flow condition.

### `pb add` — add a node

```bash
agrippa pb add --type scriptTask --name "Check pod" --pb <document_id>
agrippa pb add --type userTask   --name "Review"    --pb <document_id>
agrippa pb add --type subProcess --name "Retry loop" --pb <document_id>
agrippa pb add --type scriptTask --name "Inner" --parent SubProcess_x --pb <document_id>
```

Prints the new node id. Side effects, handled for you:

- `scriptTask` → creates an empty `scripts/NNNN_<slug>.js`; edit that file for the body.
- `userTask` → creates `pages/<slug>.yml` (minimal page) + a manifest entry; on the
  next push the page is created upstream.
- `subProcess`/`transaction` → empty container; add children with `--parent <its-id>`.

The node is added **disconnected** with stub geometry. Connect it, then `format`.

### `pb rm` — remove a node

```bash
agrippa pb rm --id ScriptTask_0mmmti4 --pb <document_id>
```

Removes the node (and, for a container, its children), **every edge pointing at it**
(from anywhere in the graph), its own outgoing edges, and its script/page files +
manifest entries. No dangling references left behind.

### `pb connect` — add a flow

```bash
# plain sequence
agrippa pb connect --from ScriptTask_a --to ScriptTask_b --pb <document_id>

# gateway branch with a condition
agrippa pb connect --from ExclusiveGateway_g --to ScriptTask_b \
  --condition '${isAlive}' --pb <document_id>

# the gateway's fallback branch
agrippa pb connect --from ExclusiveGateway_g --to EndEvent_err \
  --default --pb <document_id>
```

A flow's id is printed. Conditions default to `xsi:type="tFormalExpression"`
(override with `--condition-type`). **Gateway rule** (enforced by Activiti, warned
by this command): an `exclusiveGateway` with more than one outgoing flow must have
**exactly one** `--default` flow, and **every other** outgoing flow must carry a
`--condition`. Heed the `!` warnings `connect` prints.

### `pb disconnect` — remove a flow

```bash
agrippa pb disconnect --id SequenceFlow_1lso8x0 --pb <document_id>
agrippa pb disconnect --from ScriptTask_a --to ScriptTask_b --pb <document_id>
```

### `pb format` — lay out the diagram

```bash
agrippa pb format --pb <document_id>
```

Recomputes all node positions (left→right: start on the left, end on the right) and
edge routing via elkjs, including subprocess interiors. **Run this after every
structural edit, before push.** It also re-checks the gateway rule and reports issues.

### `pb preview` — visual check (dev)

```bash
agrippa pb preview --pb <document_id> --out /tmp/wizard.svg
```

Renders the current geometry to an SVG so you (or a human) can eyeball the result.
Not byte-faithful to the real renderer — a sanity check only.

---

## What to edit by hand

Use the **commands** for graph structure (adding/removing nodes, wiring flows).
Edit the **files directly** for content within an existing node:

| Change | How |
| --- | --- |
| A scriptTask body | edit its `scripts/NNNN_*.js` file |
| A userTask page | edit its `pages/<formKey>.yml` file |
| A node's `name`, a flow's `condition`/`name`, serviceTask `fields`/`class` | edit `structure.yaml` for that node/edge |
| Identity/flags | edit `process.yaml` |

Never hand-edit `.agrippa-pb.json`, and never hand-assign `layout`/`waypoints` — let
`pb format` own geometry.

---

## Recipes

**Append a block to the end of a linear path** (`A → End` becomes `A → New → End`):

```bash
agrippa pb add --type scriptTask --name "New" --pb W      # → ScriptTask_new
agrippa pb disconnect --from A --to End --pb W
agrippa pb connect --from A --to ScriptTask_new --pb W
agrippa pb connect --from ScriptTask_new --to End --pb W
agrippa pb format --pb W
# then edit scripts/NNNN_new.js with the body
```

**Insert a decision branch** (gateway with two conditioned exits + a default):

```bash
agrippa pb add --type exclusiveGateway --name "alive?" --pb W   # → ExclusiveGateway_g
agrippa pb connect --from ExclusiveGateway_g --to ScriptTask_ok  --condition '${isAlive}' --pb W
agrippa pb connect --from ExclusiveGateway_g --to EndEvent_err --default --pb W
agrippa pb format --pb W
```

**Add a subprocess with an inner step:**

```bash
agrippa pb add --type subProcess --name "Retry" --pb W          # → SubProcess_s
agrippa pb add --type scriptTask --name "Attempt" --parent SubProcess_s --pb W
agrippa pb format --pb W
```

---

## Safety & validation

- After every command the project is re-checked for recomposability; a broken edit
  is reported with a `WARNING`.
- `pb` commands are **local only** — nothing reaches upstream until `agrippa push`.
- `agrippa push` saves the wizard as a **draft** and backs up the upstream payload
  first; it goes live only when published (`agrippa push --publish`, or the prompt).
- `agrippa pull` refreshes a wizard from upstream and will flag a `conflict` if your
  local edits would be overwritten — it backs up local state first.

When in doubt: `pb ls` to see the graph, make the change, `pb format`, `pb preview`
to confirm, then `agrippa push`.
