# Instructions for working with Phases, MFAs, and Process-Builder wizards

You are my coding assistant developing MFAs, phases, and process-builder wizards for
our Odoo CRM. Follow instructions precisely, without doing fixes or enhancements
outside the scope of your instructions.

This workspace is an **agrippa** workspace: a local checkout of Odoo code synced via
the `agrippa` CLI. **You (the agent) never run `agrippa clone`, `agrippa pull`, or
`agrippa push`** — those are human-only operations. You edit local files, and for
wizards you also drive the `agrippa pb` editing commands (below). A human reviews and
syncs.

---

## CRM structure

### MFAs and phases

The Odoo CRM uses a special module for exposing HTTP methods to the external world.
The module name is RIP, which lets developers define "Model Function Access" records.
Model Function Access (MFA) records contain Python code executed in `safe_eval`.

Phases are `symple.triplet.phase` records tied to `helpdesk.ticket` objects.
A helpdesk ticket has an associated `helpdesk.ticket.type`, which in turn has a
`symple.workflow`. A workflow has a sequence of `symple.triplet.phase` that the ticket
crosses in its lifecycle. There are many kinds of phases, but you only care about
automatic phases that have Python code inside. In the directory structure, unless the
current folder is named "mfa", each subdirectory is a workflow, and every Python file
inside corresponds to a Python phase with code.

For phases and MFAs you simply **edit the `.py` files** — there are no agrippa
commands for you to run; a human clones/pulls/pushes them.

### Workflow structure (`workflow.yml`)

Each cloned workflow directory contains a `workflow.yml` next to its phase `.py`
files. It is **auto-generated, read-only context** describing how the workflow is
wired — the graph the editable phase files live inside. Read it to understand a
workflow before editing a phase; **never edit it** (it is regenerated on every
clone/pull and is not pushed anywhere). It does not contain phase Python code —
that lives in the `.py` files.

It holds:

- `workflow` — identity + flags (`process_type`, `is_tiqv`, `start_phase`,
  `code_excluded_phases`, and the `triplets` / ticket-type details that enter it).
- `phases` — every phase as a graph node: `id`, `name`, `phase_code`,
  `set_result_automatically`, `has_code_file` (true ⇒ an editable `.py` was cloned
  for it), process/integration flags, `timeout`, `allowed_processes`,
  `allowed_manual_phases`, and `results`.
- `results` (per phase) — the **outgoing edges**: each `result` has a `next_phase`
  plus, for `from_code` phases, the `code_values` the phase's Python must assign to
  `result` to take that edge (and `triplet_details` for `from_triplet` phases).

So to find "what value does this phase set to go to phase X", read `workflow.yml`:
match the result whose `next_phase` is X and use its `code_values`.

### Code inside phases and MFAs

The following applies to both phases and MFAs.

Some global utilities are made available inside the script, such as:

- `json_dumps` (from `json.dumps`)
- `json_loads` (from `json.loads`)
- `datetime` (root-level import from datetime)
- `dateutil` (root-level import from dateutil)
- `request` (from `requests.request`)
- `log` (logging method)
- `format_exc` (from `traceback.format_exc`)
- `first` (from `fields.first`)
- `case_id` (phases only — the current `helpdesk.ticket`)

The value of the `result` variable is used to construct the HTTP response.
The `make_response` helper allows returning error states, e.g.
`result = make_response((500, 500), "Custom error message")`.

Some patterns not allowed in Odoo's `safe_eval`:

- f-strings
- imports
- lambdas inside functions (`def` inside another function is fine)
- doc strings (you cannot write to dunder fields)

Notably unavailable:

- `getattr`
- `setattr`

### Communication between phases

A key entity is `symple.pb.process.data`. This model stores arbitrary data (most
commonly JSON) in the `payload` field. It also has a `get_payload` method, which gives
you the parsed JSON it contains. Phases, MFAs and other components commonly communicate
via this model.

The key-value store (kv_store) is a special process-data record accessible via
`case_id.kv_store()`. It gives shorthand access to a process-data record unique to each
case. It exposes 4 methods:

- `get("key")`
- `set("key", "value")`
- `get_many("key", "key2")` → `a, b = case_id.sudo().kv_store().get_many("a, b")`
- `set_many({"a": 1, "b": 2})`

When possible, prefer the kv_store over manually creating and searching process-data
records.

---

## Process-builder wizards

A wizard is a BPMN process the CRM runs as a guided flow. Locally it has been
**decomposed** into editable files. For wizards you are expected to **drive the
`agrippa pb` commands** for structural changes — they hide BPMN id generation, the
nested-YAML graph, dangling-edge cleanup, and the script/page/manifest bookkeeping you
would otherwise get wrong by hand.

> **You never run `agrippa push` or `agrippa pull`.** You only edit local files and run
> the local, read/write `agrippa pb` subcommands. A human syncs and publishes.

### Decomposed project layout

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
`agrippa-pb.json` is a massive json file. **Do not read it unless strictly required** — use `pb ls` and explore deconstructed files.

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

### Your loop

```
agrippa pb ls            # discover node/edge ids
agrippa pb add / rm / connect / disconnect / set-default   # change the graph
# STOP. Do NOT format. Do NOT push. Report back to the human (see Formatting below).
```

Every `pb` command targets **one** wizard. **Always pass `--pb <document_id>`** so you
never hit an interactive prompt.

### Commands

#### `pb ls` — discover ids

```bash
agrippa pb ls --pb <document_id>
```

Flat list of every node with its id, type, name, parent (if nested), and outgoing
edges. **Start here** to find the ids you need. Example:

```
ScriptTask_0mmmti4  (scriptTask)  "Init"
    → ExclusiveGateway_1lghfov  (SequenceFlow_1lso8x0)
ExclusiveGateway_1lghfov  (exclusiveGateway)  "eg err"
    → EndEvent_err  (SequenceFlow_a)  [default]
    → ScriptTask_next  (SequenceFlow_b)  if ${isAlive}
```

`[default]` marks a gateway's default flow; `if …` shows a flow condition.

#### `pb add` — add a node

```bash
agrippa pb add --type scriptTask --name "Check pod" --pb <document_id>
agrippa pb add --type userTask   --name "Review"    --pb <document_id>
agrippa pb add --type subProcess --name "Retry loop" --pb <document_id>
agrippa pb add --type scriptTask --name "Inner" --parent SubProcess_x --pb <document_id>
```

Prints the new node id. Side effects, handled for you:

- `scriptTask` → creates an **empty** `scripts/NNNN_<slug>.js`; edit that file for the body.
- `userTask` → creates a **stub** `pages/<slug>.yml` + a manifest entry (no page content).
- `subProcess`/`transaction` → empty container; add children with `--parent <its-id>`.

The node is added **disconnected** with placeholder geometry. Connect it next.

**Insert mode** — `--from <id> --to <id>` splices the new node into an existing flow
instead of adding it disconnected:

```bash
agrippa pb add --type scriptTask --name "New" --from A --to End --pb <document_id>
```

Requires **exactly one** existing edge `A → End` already (errors if there's none, or
more than one — ambiguous). That edge is kept (same id, name, condition, gateway
`default` reference) and retargeted onto the new node; a second plain edge runs
new-node → `End`. `--parent` is implied by `A`/`End`'s container, so don't pass both.
`A`/`End` must be in the same container — it errors on boundary-crossing flows.

#### `pb rm` — remove a node

```bash
agrippa pb rm --id ScriptTask_0mmmti4 --pb <document_id>
```

Removes the node (and, for a container, its children), **every edge pointing at it**
(from anywhere in the graph), its own outgoing edges, and its script/page files +
manifest entries. No dangling references left behind.

#### `pb connect` — add a flow

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
(override with `--condition-type`). **Gateway rule** (enforced by Activiti, warned by
this command): an `exclusiveGateway` with more than one outgoing flow must have
**exactly one** `--default` flow, and **every other** outgoing flow must carry a
`--condition`. Heed the `!` warnings `connect` prints.

#### `pb disconnect` — remove a flow

```bash
agrippa pb disconnect --id SequenceFlow_1lso8x0 --pb <document_id>
agrippa pb disconnect --from ScriptTask_a --to ScriptTask_b --pb <document_id>
```

#### `pb set-default` — change a gateway's default flow

```bash
agrippa pb set-default --id SequenceFlow_b --pb <document_id>
agrippa pb set-default --from ExclusiveGateway_g --to EndEvent_err --pb <document_id>
```

Flips an **already-existing** flow to be its source gateway's `default`, by edge id or
by `--from`/`--to` pair. Use this when a gateway already has a default and you want a
different outgoing flow to become it — no need to `disconnect` and re-`connect` just to
move the flag. The source must be an `exclusiveGateway`. Re-runs the gateway lint and
prints any `!` warnings (e.g. a now-default flow that still carries a condition, or a
non-default flow left without one).

#### `pb preview` — visual check

```bash
agrippa pb preview --pb <document_id> --out /tmp/wizard.svg
```

Renders the current geometry to an SVG so a human can eyeball the result. Safe to run.
Not byte-faithful to the real renderer — a sanity check only.

### Formatting — a human decision, do NOT run it yourself

`agrippa pb format` re-lays-out the **entire** wizard with an automatic algorithm.
On an existing wizard this **discards the human's hand-tuned layout** and produces a
drastically different diagram. That may or may not be acceptable — **only the human
decides.**

So when you have added/connected blocks, the new nodes are left with placeholder
positions, and **you stop there**. Report to the human what you changed and that the
new blocks need positioning, then let them choose one of:

1. **Run `agrippa pb format`** themselves — accepts a full automatic re-layout of the
   whole wizard (existing arrangement is lost), or
2. **Position the new blocks by hand in the UI** after a human pushes the change —
   preserving the existing layout.

Never run `pb format` unless the human explicitly tells you to, with that trade-off
understood.

### What to edit by hand (vs. commands)

Use the **commands** for graph structure (adding/removing nodes, wiring flows).
Edit the **files directly** for content within an existing node:

| Change | How |
| --- | --- |
| A scriptTask body | edit its `scripts/NNNN_*.js` file |
| A userTask page | edit its `pages/<formKey>.yml` file |
| A node's `name`, a flow's `condition`/`name`, serviceTask `fields`/`class` | edit `structure.yaml` for that node/edge |
| Identity/flags | edit `process.yaml` |

Never hand-edit `.agrippa-pb.json`, and never hand-assign `layout`/`waypoints`.

### Recipes

**Insert a block into an existing path** (`A → B` becomes `A → New → B`, anywhere in
the graph, not just the end):

```bash
agrippa pb add --type scriptTask --name "New" --from A --to B --pb W   # → ScriptTask_new
# then edit scripts/NNNN_new.js with the body, and report back (see Formatting)
```

Errors out instead of guessing if `A → B` doesn't have exactly one edge — fix the
graph (`pb ls`) first if so.

**Insert a decision branch** (gateway with two conditioned exits + a default):

```bash
agrippa pb add --type exclusiveGateway --name "alive?" --pb W   # → ExclusiveGateway_g
agrippa pb connect --from ExclusiveGateway_g --to ScriptTask_ok  --condition '${isAlive}' --pb W
agrippa pb connect --from ExclusiveGateway_g --to EndEvent_err --default --pb W
```

**Add a subprocess with an inner step:**

```bash
agrippa pb add --type subProcess --name "Retry" --pb W          # → SubProcess_s
agrippa pb add --type scriptTask --name "Attempt" --parent SubProcess_s --pb W
```

In every recipe: after the structural edits, **stop** and report — do not format, do
not push.

### Safety

- `pb` commands are **local only** — nothing reaches upstream. Syncing
  (`clone`/`pull`/`push`) and publishing are the human's job, never yours.
- After every command the project is re-checked for recomposability; a broken edit is
  reported with a `WARNING`.
- When in doubt: `pb ls` to see the graph, make the structural change, `pb preview` to
  show the human, then hand off.


