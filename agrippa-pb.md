# Instructions for working with Phases, MFAs, Process-Builder wizards, and LRPs

You are my coding assistant developing MFAs, phases, process-builder wizards, and
long-running processes (LRPs) for our Odoo CRM. Follow instructions precisely, without
doing fixes or enhancements outside the scope of your instructions.

This workspace is an **agrippa** workspace: a local checkout of Odoo code synced via
the `agrippa` CLI. **You (the agent) may freely run `agrippa clone` and `agrippa
pull`** — neither writes to the server, so both are safe to run indiscriminately.
**You may only run `agrippa push` when a human has explicitly given you permission to
push for that specific invocation** — pushing writes to the server and is otherwise
off-limits. `agrippa restore` overwrites local files from a `.backup/` snapshot; that
stays human-only, since it can clobber local edits. You edit local files, and for
wizards and LRPs you also drive the `agrippa pb` editing commands (below). A human
reviews, restores, and pushes — unless they've explicitly told you to push yourself.

Credentials (Keycloak/RIP/PB) are never stored in `agrippa.yaml` — it holds only
workspace inventory (paths/ids/checksums) and is safe to read, edit, or commit.
`agrippa` resolves credentials from `--secrets-file <path>` (if the human gives you one)
or the global `~/.config/prbot/config`, in that order. Never write literal credential
values into `agrippa.yaml` or any other file in this repo. If a command fails with a
"not configured" error, ask the human for a `--secrets-file` path rather than trying to
source or guess values yourself.

For a quick id/name lookup without doing a full clone, `agrippa clone --list` (same
status as `prbot export --list` below) only prints candidates (id, name, and
document_id/guid where relevant):

```bash
agrippa clone --phase --list -Q voltura     # workflow id, name
agrippa clone --mfa --list -Q ticket        # mfa id, "model_name / name"
agrippa clone --pb --list -Q voltura        # document_id, guid, name
agrippa clone --lrp --list -Q renewal       # id, name
```

`--list` always requires one of `--phase`/`--mfa`/`--pb`/`--lrp` (it errors otherwise —
there's no type to list without one).

`agrippa` ships alongside a sibling CLI, **`prbot`** — exports, task docs, and PR/release
automation (see **Using prbot**, at the end of this doc). The same read/write split
applies there as everywhere else in this doc: **read-only lookups** (`--list`/`--query`,
`export ... --list`, `doc`) are yours to run freely. **Anything that writes** — an actual
`export ... -m/--id/--model/--record` (writes files, commits), `autopr` (branch, PR,
Trident, changelog, git push) — you only run when the human explicitly tells you to for
that specific invocation. Default to asking, not assuming a prior go-ahead still applies.

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

For phases and MFAs you simply **edit the `.py` files** — there are no `pb` commands
for these. You may `agrippa clone`/`agrippa pull` them yourself; pushing requires
explicit human permission (see Safety above).

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

Phases and MFAs both run stored Python through Odoo 15 `safe_eval` (mode `exec`), but
they run in **different environments with different globals**. The shared sandbox rules
come first; the per-environment globals follow.

#### Shared sandbox rules (apply to both)

Patterns **not allowed** by `safe_eval`:

- **`import`** — forbidden outright.
- **f-strings** — do not use them; use `"...{}".format(...)` instead. (The current
  runtime's opcode whitelist technically permits them, but team convention and observed
  failures mean you must avoid them.)
- **attribute assignment** (`obj.attr = x`) — forbidden (`STORE_ATTR` is blocked). You
  cannot set attributes; write through the ORM (`record.write({...})`) instead.
- **dunder names** — any name containing `__` (e.g. `__class__`) is rejected. This is why
  you cannot write doc strings.
- **`getattr` / `setattr` / `eval`** — not in the builtins, so unavailable.

Patterns that **are** allowed (but with a sharp limit):

- **lambdas and nested `def` are creatable, but cannot form closures.** A lambda/nested
  function may reference only its **own parameters, module globals** (`env` etc.) **and
  constants**. It must **not** capture a variable from the enclosing function — the
  closure-cell opcodes (`LOAD_DEREF`/`STORE_DEREF`/`LOAD_CLOSURE`/`MAKE_CELL`) are not
  whitelisted, so a closure fails validation.
    - ✅ works: `recs.filtered(lambda r: r.wizard_result == "CANCEL")` — no captured locals
    - ❌ fails: `recs.filtered(lambda r: r.x == target)` — `target` is an enclosing local
    - In practice nested functions are rarely usable, since they almost always close over
      local state. Self-contained `.filtered(lambda r: ...)` predicates are the common
      legitimate use and appear throughout real phase code.

#### Phase environment (`symple.triplet.phase`)

Phase code runs against a full Odoo "server action" context. Globals available:

- `env` — the **full Odoo ORM** (`env["model"].sudo().search/create/write/browse`)
- `case_id` — the current `helpdesk.ticket`
- `Command` — x2many command namespace
- `ValidationError` — raise to abort with a warning
- `request` (= `requests.request`), for outbound HTTP
- `json_dumps` (= `json.dumps`), `json_load` (= `json.load` — note: **not** `json_loads`)
- `time`, `datetime`, `dateutil`, `timezone`, `float_compare`, `OrderedDict`
- `b64encode`, `b64decode`
- `log(message, level='info')`, `format_exc` (= `traceback.format_exc`), `first`
  (= `fields.first`), `uid`, `user`

There is **no** `make_response` in phases.

**Returning a result:** assign `result` as a **string** — it must match one of the phase's
`code_values` in `workflow.yml` (e.g. `result = "RES1"`). It is **not** a dict. The string
is matched against `result.code.configurator` to pick the outgoing edge.

**Reporting errors:** write the message onto the case, conventionally
`case_id.write({"info_message": "..."})` (`error_message` also exists but `info_message`
is the prevailing choice).

**Case helpers** (defined on `helpdesk.ticket` in `sorgenia_tools`):

- `case_id.kv_store()` — the per-case key/value store (see below).
- `case_id.last_staging("<process_name>")` — returns the latest
  `symple.pb.process.data` for that process on the case, raising `ValidationError` if
  none exists. Prefer this over searching `symple.pb.process.data` by hand.

#### MFA environment (RIP)

MFA code runs to build an HTTP response, with a much smaller context. Globals available:

- `env` — the Odoo ORM
- `make_response` — build a response, e.g.
  `result = make_response((500, 500), "Custom error message")`
- `logger` — a standard Python logger
- `result` — assign the response payload (a recordset or JSON-serialisable content); it
  is consumed to construct the HTTP response
- the incoming request data: `method`, `model`, `records`, `user`, `args`, `headers`,
  `body`, `httprequest`
- `datetime`, `dateutil`

MFAs have **no** `case_id`, `Command`, `ValidationError`, `json_dumps`, `first`, `log`,
or `format_exc` by default.

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
- `get_many("key1", "key2")` → `a, b = case_id.sudo().kv_store().get_many("key1", "key2")`
- `set_many({"a": 1, "b": 2})`

When possible, prefer the kv_store over manually creating and searching process-data
records.

---

## Process-builder wizards and long-running processes (LRPs)

A wizard or LRP is a BPMN process the CRM runs as a guided flow (wizards) or a
long-running background process (LRPs). Both are the **same underlying Activiti/
Symphony BPMN XML**, so locally they share **one** decomposed layout and one `pb`
editing suite — everything below applies to both unless a difference is called out.
For wizards/LRPs you are expected to **drive the `agrippa pb` commands** for
structural changes — they hide BPMN id generation, the nested-YAML graph,
dangling-edge cleanup, and the script/page/manifest bookkeeping you would otherwise
get wrong by hand.

**LRP-specific differences:**

- **No pages.** LRPs never contain `userTask`. `pb add --type userTask` errors out on
  an LRP project.
- **Selector is `name`, not `document_id`.** LRPs have no stable id — the Symphony id
  changes on every save — so `--pb <name>` (not a `document_id`) is how you target an
  LRP project. `pb ls`/error messages show `name` when `document_id` is absent.
- **A few extra node types show up more often**: `intermediateCatchEvent`,
  `intermediateThrowEvent`, `callActivity`, `parallelGateway`, `eventBasedGateway` (see
  Node types below) — these exist for PBs too but are common in LRPs.
- Publishing is called **deploy** for LRPs (same `agrippa push
  --publish`/`--skip-publish` flow as wizard publish, gated by the same explicit-
  permission rule — not a `pb` command).

> **You only run `agrippa push` with explicit human permission.** `agrippa clone` and
> `agrippa pull` are fine to run freely — they don't write to the server. `agrippa
> restore` overwrites local files and stays human-only. Otherwise you edit local files
> and run the local, read/write `agrippa pb` subcommands. A human restores and
> publishes/deploys, unless they've told you to push.

### Decomposed project layout

```
<wizard-or-lrp-dir>/
  process.yaml      identity + top-level flags (envelope)
  structure.yaml    THE graph: nodes hold their outgoing `edges` and nested
                    `nodes` (for subProcess/transaction); inline geometry
  scripts/NNNN_*.js one scriptTask body each (byte-exact)
  pages/<formKey>.yml one userTask page object each (PB only — LRPs have no pages/)
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
`scriptTask`, `serviceTask`, `userTask` (PB only), `subProcess`, `transaction`,
`intermediateCatchEvent`, `intermediateThrowEvent`, `callActivity`,
`parallelGateway`, `eventBasedGateway`.

### Your loop

```
agrippa pb ls            # discover node/edge ids
agrippa pb add / rm / connect / disconnect / set-default   # change the graph
agrippa pb map           # see where things sit (rows, positions, gaps)
agrippa pb place / space / compact / route   # position the new blocks
agrippa pb lint --layout # check structure AND the drawing
# STOP. Do NOT format. Do NOT push. Report back to the human (see Formatting below).
```

`pb format` is still human-only (see Formatting below). The layout commands are
not: they move only what you name and leave the rest of the diagram alone, so
they are safe on a hand-tuned project in a way a full re-layout is not.

Every `pb` command targets **one** wizard or LRP. **Always pass
`--pb <document_id_or_name>`** (a wizard's `document_id`, or an LRP's `name`) so you
never hit an interactive prompt.

### Commands

#### `pb ls` — discover ids

```bash
agrippa pb ls --pb <document_id_or_name>
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
agrippa pb add --type scriptTask --name "Check pod" --pb <document_id_or_name>
agrippa pb add --type userTask   --name "Review"    --pb <document_id_or_name>
agrippa pb add --type subProcess --name "Retry loop" --pb <document_id_or_name>
agrippa pb add --type scriptTask --name "Inner" --parent SubProcess_x --pb <document_id_or_name>
```

Prints the new node id. Side effects, handled for you:

- `scriptTask` → creates an **empty** `scripts/NNNN_<slug>.js`; edit that file for the body.
- `userTask` → creates a **stub** `pages/<slug>.yml` + a manifest entry (no page content).
  **PB only** — rejected with an error on an LRP project (LRPs have no user tasks).
- `subProcess`/`transaction` → empty container; add children with `--parent <its-id>`.
- new event/gateway types (`intermediateCatchEvent`, `intermediateThrowEvent`,
  `callActivity`, `parallelGateway`, `eventBasedGateway`) → sized/laid out like their
  closest existing counterpart, no extra scaffold files.

The node is added **disconnected** with placeholder geometry. Connect it next.

**Insert mode** — `--from <id> --to <id>` splices the new node into an existing flow
instead of adding it disconnected:

```bash
agrippa pb add --type scriptTask --name "New" --from A --to End --pb <document_id_or_name>
```

Requires **exactly one** existing edge `A → End` already (errors if there's none, or
more than one — ambiguous). That edge is kept (same id, name, condition, gateway
`default` reference) and retargeted onto the new node; a second plain edge runs
new-node → `End`. `--parent` is implied by `A`/`End`'s container, so don't pass both.
`A`/`End` must be in the same container — it errors on boundary-crossing flows.

#### `pb rm` — remove a node

```bash
agrippa pb rm --id ScriptTask_0mmmti4 --pb <document_id_or_name>
```

Removes the node (and, for a container, its children), **every edge pointing at it**
(from anywhere in the graph), its own outgoing edges, and its script/page files +
manifest entries. No dangling references left behind.

#### `pb connect` — add a flow

```bash
# plain sequence
agrippa pb connect --from ScriptTask_a --to ScriptTask_b --pb <document_id_or_name>

# named branch (required when the source has 2+ outgoing flows and this is non-default)
agrippa pb connect --from ExclusiveGateway_g --to ScriptTask_b \
  --name "alive" --condition '${isAlive}' --pb <document_id_or_name>

# the gateway's fallback branch (default needs no name)
agrippa pb connect --from ExclusiveGateway_g --to EndEvent_err \
  --default --pb <document_id_or_name>
```

A flow's id is printed. Conditions default to `xsi:type="tFormalExpression"`
(override with `--condition-type`). **Rules** (warned by this command and by `pb lint`):

- An `exclusiveGateway` with more than one outgoing flow must have **exactly one**
  `--default` flow, and **every other** outgoing flow must carry a `--condition`.
- Any node with more than one outgoing flow: every **non-default** flow must have a
  `--name` (operators need labels to distinguish branches at runtime).
- Only `exclusiveGateway` may have more than one **incoming** flow.
- An `exclusiveGateway` may not have both multiple incoming **and** multiple outgoing
  flows — pick one direction (merging or splitting), not both.

Heed the `!` warnings `connect` prints.

#### `pb disconnect` — remove a flow

```bash
agrippa pb disconnect --id SequenceFlow_1lso8x0 --pb <document_id_or_name>
agrippa pb disconnect --from ScriptTask_a --to ScriptTask_b --pb <document_id_or_name>
```

#### `pb lint` — check for structural issues

```bash
agrippa pb lint --pb <document_id_or_name>
```

Runs all diagram rules and prints any violations. Exits 1 if issues found. Run after
every batch of structural edits before handing off to a human. Rules checked:

- `exclusiveGateway` default/condition rule (2+ outgoing → one default, rest conditioned)
- Non-default outgoing flows must have a name when the source has 2+ outgoing flows
- Only `exclusiveGateway` may have multiple incoming flows
- `exclusiveGateway` may not have both multiple incoming and multiple outgoing flows

`pb format` and `pb connect` also surface the same warnings inline.

`pb lint` also runs eslint against every `scripts/*.js` body, using whatever
`eslint.config.mjs` is scaffolded at the workspace root by `agrippa init` (which imports
`@waron97/prbot/eslint`). This needs a one-time `npm install` in the workspace root; if
`node_modules/.bin/eslint` isn't there yet, `pb lint` prints a warning and skips the
script-lint step instead of failing. Rules enforced:

- ES5-only syntax (`eslint-plugin-es5`) — scripts run on Activiti's plain ES5 engine, not a
  modern JS runtime; arrow functions, `let`/`const`, template literals, etc. are rejected.
- `no-empty-error-code` — `execution.setVariable('errorCode', '')` breaks the backend's
  variable read (`400 ERR-SYM-007`; the page never opens even though the process stays
  `in progress`). The convention for "no error" is `'0'`, not `''` — also flags a local
  variable that's assigned `''` on some code path before being passed to `setVariable`.

#### `pb set-default` — change a gateway's default flow

```bash
agrippa pb set-default --id SequenceFlow_b --pb <document_id_or_name>
agrippa pb set-default --from ExclusiveGateway_g --to EndEvent_err --pb <document_id_or_name>
```

Flips an **already-existing** flow to be its source gateway's `default`, by edge id or
by `--from`/`--to` pair. Use this when a gateway already has a default and you want a
different outgoing flow to become it — no need to `disconnect` and re-`connect` just to
move the flag. The source must be an `exclusiveGateway`. Re-runs the gateway lint and
prints any `!` warnings (e.g. a now-default flow that still carries a condition, or a
non-default flow left without one).

#### `pb preview` — visual check

```bash
agrippa pb preview --pb <document_id_or_name> --out /tmp/wizard.svg
```

Renders the current geometry to an SVG so a human can eyeball the result. Safe to run.
Not byte-faithful to the real renderer — a sanity check only. You cannot read an SVG:
use `pb map` for your own check and `pb preview` when a human wants to look.

#### `pb map` — see the layout (this is your `pb preview`)

```bash
agrippa pb map --pb <document_id_or_name>
agrippa pb map --ids --pb <document_id_or_name>     # node ids instead of names
```

Text render of the current geometry: one row per horizontal band, nodes left to right
with the x each sits at, `->` where a flow directly connects two neighbours, `..NNNpx..`
where there is a hole, then every flow that crosses between rows. Ends with any layout
issues. Run it before and after every layout change — it is the only way you can see
what you did.

```
B2WA_case_await_point_active - 25 node(s), 4 row(s), 1776x442, spacing 36px

  y=38   (END error)@587
  y=125  <EG err join>@580
  y=220  (START)@40 -> [Parse request]@120 -> <EG parse ok?>@250 -> ...
  y=420  (Wait 30s)@1007 -> ..287px.. <EG attempts exhausted?>@1330 -> ...
```

`(round)` = event, `<diamond>` = gateway, `[box]` = task, `{brace}` = container. Rows
are **inferred from the coordinates** on each run — they are not stored in the project
and are not a thing you can declare.

#### Layout commands — position blocks without touching coordinates

Between `pb connect` (which leaves a new node at a placeholder position) and `pb format`
(which re-lays-out everything), these move only what you name and re-route the flows they
touch. None of them re-lay-out the diagram, so a hand-tuned arrangement survives.

```bash
# put a new node into a row, shoving the rest of the diagram right to make room
agrippa pb place --id ScriptTask_new --after ScriptTask_prev --push --pb W

# put it on another row (rows are named by their centre-y, from `pb map`)
agrippa pb place --id EndEvent_err --lane 125 --at ExclusiveGateway_g --pb W

# take the space back after removing a node
agrippa pb compact --after ScriptTask_prev --pb W

# open/close space by hand
agrippa pb space --after ScriptTask_prev --by 120 --pb W
agrippa pb compact --lane 220 --pb W

# fix the arrows after moving something by hand
agrippa pb route --id SequenceFlow_xyz --pb W
agrippa pb route --all --pb W
agrippa pb route --from A --to B --via 640,120 --pb W    # force a bend point
```

Notes that matter:

- **`--push` and `compact --after` shift the whole diagram**, not just the row. These
  diagrams are read by column as much as by row (a loop-control gateway sits under the
  gateway it belongs to), and moving one row alone silently breaks those alignments.
- **`compact --lane` / `--all` re-flow one row's spacing and so *will* break columns.**
  Use them to tidy a row's rhythm, not to close a hole — `compact --after` is the one
  that closes a hole without disturbing columns. `pb lint --layout` catches the damage
  (`column-jitter`), and each finding names the `pb place --at` that repairs it.
- **Do not chase lint findings one at a time on an already-broken diagram.** Each `--at`
  fix is local and can push a node into its neighbour or shift the near-miss one column
  over. If more than a couple of findings appear, re-flow the affected rows wholesale
  with `pb layout dump`/`apply` instead.
- **Spacing is inferred** from the diagram's own rhythm — the gap it already uses between
  most neighbours. Override with `--gap`.
- **Every layout command re-routes what it touched**, so you never have to remember to.
  An edge whose path does not change is left untouched, so re-running is free.
- Root-scope nodes only. A node inside a `subProcess`/`transaction` is refused — those
  are laid out by `pb format`.

#### `pb layout dump` / `pb layout apply` — a sweeping re-arrangement

For a whole-diagram reformat, dump the layout as an editable spec, rewrite it, apply it:

```bash
agrippa pb layout dump --pb W --out /tmp/layout.txt
# edit /tmp/layout.txt — reorder ids, move them between rows, add/remove rows
agrippa pb layout apply /tmp/layout.txt --pb W
```

```
lane 125:
    ExclusiveGateway_mwmkcsd@ExclusiveGateway_8cev0x8
lane 220:
    StartEvent_1@40 ScriptTask_61uwk8o@120 ExclusiveGateway_t4ms0fy@250 ...
```

- `lane <y>:` starts a row at that centre-y. A new number creates a row.
- Ids run left to right; each follows the previous one at the default spacing.
- `id@<other-id>` puts a node in the same column as another node — use this to keep a
  branch under the step it belongs to. `id@<number>` pins an absolute x. `+120` inserts
  extra space.
- **Nodes you leave out keep their current position**, so a partial spec re-flows only
  the rows you list.
- The spec file is scratch input you pass by path. It is **not** part of the project,
  never written into the project directory, and nothing about it is stored in
  `structure.yaml`.

#### `pb format --elk` / `--happy` — steering the automatic layout

Only relevant when a human has asked for a `pb format`:

```bash
agrippa pb format --elk elk.layered.feedbackEdges=true --pb W
agrippa pb format --happy StartEvent_1,ScriptTask_a,...,EndEvent_ok --pb W
```

`--elk key=value` (repeatable) passes a raw ELK option through; unknown keys are rejected
with a suggestion rather than silently ignored. `--happy <ids>` names the flow path to
straighten, overriding the heuristic that follows each gateway's `default` — which guesses
wrong when a `default` legitimately points into a retry loop. `--no-happy` turns the
prioritisation off. These steer ELK; they do not make it produce flat rows — the layout
commands above are what does that.

### Formatting — a human decision, do NOT run it yourself

`agrippa pb format` re-lays-out the **entire** wizard/LRP with an automatic algorithm.
On an existing project this **discards the human's hand-tuned layout** and produces a
drastically different diagram. That may or may not be acceptable — **only the human
decides.**

So when you have added/connected blocks, the new nodes are left with placeholder
positions. You have three options, and **only the third is off-limits to you**:

1. **Position the new blocks yourself** with `pb place`/`space`/`compact`/`route`, then
   check with `pb map` and `pb lint --layout`. This preserves the existing layout — it
   moves only what you name — and is the normal thing to do. Prefer it.
2. **Leave them placed by hand in the UI** by a human after push/deploy — also preserves
   the existing layout.
3. **`agrippa pb format`** — a full automatic re-layout of the whole project, existing
   arrangement lost. **Never run this unless the human explicitly tells you to**, with
   that trade-off understood.

The distinction is not "geometry is dangerous" — it is that `format` is the only one that
throws away work someone already did. Everything under Layout commands above is
incremental and reversible.

**Layout is a real change.** Node positions and waypoints are part of what gets pushed —
agrippa's change detection counts them, so a layout edit makes the project dirty and will
go upstream on the next push, exactly like a script edit. It is not free, and it is not
cosmetic-only. (Flow *label* positions are the one exception; they are excluded.)

### What to edit by hand (vs. commands)

Use the **commands** for graph structure (adding/removing nodes, wiring flows).
Edit the **files directly** for content within an existing node:

| Change | How |
| --- | --- |
| A scriptTask body | edit its `scripts/NNNN_*.js` file |
| A userTask page | edit its `pages/<formKey>.yml` file |
| A node's `name`, a flow's `condition`/`name`, serviceTask `fields`/`class` | edit `structure.yaml` for that node/edge |
| Identity/flags | edit `process.yaml` |

Never hand-edit `.agrippa-pb.json`, and never hand-assign `layout`/`waypoints` by editing
the YAML. That prohibition now has a proper alternative: use the layout commands
(`pb place`, `pb space`, `pb compact`, `pb route`, `pb layout apply`), which do the
arithmetic, keep the arrows attached, and can be checked with `pb map`/`pb lint --layout`.
Hand-computed coordinates have none of that.

### Script formatting — beware push diffs

The workspace scaffold from `agrippa init` also adds an `npm run format` (prettier) script
for `*/scripts/*.js`. Script bodies are otherwise written byte-exact — running `format`
rewrites them, and agrippa's checksum-based change detection treats that rewrite as a real
local change. The next `agrippa pb push` will send the reformatted body upstream as an
actual diff against the remote process, not just cosmetic noise. Don't run `npm run format`
on a script you don't also intend to push.

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
agrippa pb connect --from ExclusiveGateway_g --to ScriptTask_ok \
  --name "alive" --condition '${isAlive}' --pb W
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

- `pb` commands are **local only** — nothing reaches upstream. `agrippa clone`/`pull`
  are also safe to run freely — read-only against the server. `agrippa restore`
  overwrites local files from backup and stays human-only. `agrippa push` (and
  publishing) writes to the server: only run it when a human has explicitly told you
  to push.
- After every command the project is re-checked for recomposability; a broken edit is
  reported with a `WARNING`.
- When in doubt: `pb ls` to see the graph, make the structural change, `pb map` to check
  the result yourself, `pb preview` to show the human, then hand off.
- The layout commands are local and incremental — run them freely. `pb format` is the
  exception and stays human-only.

---

## Using prbot

`prbot` is the sibling CLI to `agrippa` — exports, task docs, and PR/release automation
against Azure DevOps + Odoo/RIP + Trident. Same rule as the rest of this doc: **reads
are yours to run whenever useful; writes need the human's explicit go-ahead for that
specific invocation** — a prior "yes" doesn't carry over to the next one.

`prbot --version` / `-V` — sanity-check which version is installed. Always safe.

### Reads — run freely

`export pb/imperex/lrp --list`, optionally with `-Q/--query <text>` (fuzzy-filters by
name), print candidates without exporting or touching git:

```bash
prbot export pb --list -Q voltura            # document_id, guid, name
prbot export imperex --list -Q ticket        # model names (add --model X to list that model's records instead)
prbot export imperex --model helpdesk.ticket --list -Q foo
prbot export lrp --list -Q renewal           # id, name
```

Use these the same way you'd use `agrippa pb ls` — to find the exact `document_id`/
`model`/`record`/`id` you'll need if the human later asks for an export, or just to
answer "does X exist / what's it called".

### Writes — human must explicitly ask, every time

These write files (and, unless `--no-commit`, `git commit`) or touch DevOps/Trident/git
remotes. Do not run them speculatively, and do not treat an earlier approval as covering
a later, different invocation.

```bash
prbot export pb -m <document_id>              # writes .cloudbuild/pb/... zip, commits
prbot export imperex --model <name> --record <id>   # writes sorgenia_imperex_metadata/..., commits
prbot export lrp -m <id>                      # writes .cloudbuild/symphony/... bpmn, commits
prbot doc -t <trident_id> [-o <dir>]          # writes a trident_<id>/ folder (local-only, no git — lower stakes, but still ask)
prbot autopr -t <trident_id> -m "<message>" --exact-changelog-section "### <exact heading>"
    # creates branch, pushes, opens a DevOps PR, updates the Trident checklist,
    # appends + commits + pushes a CHANGELOG.md entry — fully non-interactive with
    # this flag combination, and correspondingly higher-stakes; confirm every field
    # (task id, message, section) with the human before running it, not just the
    # fact that autopr should run at all.
```

`--exact-changelog-section` must be the section's **full heading line including `### `**
(e.g. `"### CROSS_31.1 - ML"`), not just its text — copy it verbatim from
`CHANGELOG.md` or from the error message `autopr` prints when it doesn't match (it lists
every available heading). Prefer `autopr --worktree` when running it yourself: it
creates the branch in a separate worktree instead of switching the human's current
checkout out from under them.

