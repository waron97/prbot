# Proposal: incremental layout commands between `pb connect` and `pb format`

**Status:** proposal only — no code in this document has been implemented. Written after a real
session (2026-09-07/08, workspace `sorgenia_workspace`, LRP `B2WA_case_await_point_active`) where an
agent had to hand-compute every node coordinate and edge waypoint in `structure.yaml` for a 25-node
graph with a retry loop, because the two existing options were both wrong for the job: `pb format`
(full ELK re-layout) discards a hand-tuned diagram and, on this graph, actively made things worse; raw
`layout`/`waypoints` editing is exactly what `CLAUDE.md`/`agrippa-pb.md` tell an agent never to do,
for good reason (it's tedious, error-prone geometry math with no feedback until a human opens the
real editor). A fixture reproducing the exact graph that motivated this is at
`fixtures/case_await_point_active/` (see bottom of this document).

## Why this gap exists (grounded in the code)

- `pbEdit.js`'s own comment states the intended split: *"Geometry is intentionally stubbed (correct
  size, placeholder position) — the agent runs `pb format` to finalize layout. No IO happens here."*
  `connect` (`pbEdit.js:361-382`) stubs a new edge's waypoints as a **straight line, center-to-center**
  between the two nodes' *current* (often still-placeholder) positions — not a routed path, just a
  marker for `pb format` to fix later. There is no command that computes a *real* waypoint (orthogonal,
  port-aware) without invoking the full ELK pass.
- `pb format` (`pbLayout.js`) is genuinely all-or-nothing: `autoLayout(structure)` rebuilds every
  node's `layout` and every edge's `waypoints` in one ELK invocation over the whole graph. There is no
  partial mode, no "keep these nodes fixed," no per-subgraph scope.
- The one steering knob that exists — `happyEdgesInScope` boosting `elk.layered.priority.*` to `10`
  for edges reachable by always following a gateway's `default` flow — is a **global heuristic with no
  escape hatch**: if a `default` flow happens to point into a retry loop (a legitimate, common shape
  for a polling/wait pattern — see the fixture), the heuristic silently prioritizes the wrong path and
  there is no flag to override it short of rewriting which flow is `default` in the diagram itself
  (see "What actually fixed the real case," below).

## What actually happened on the real case (evidence for the priority order below)

Three things were tried, in this order, on the fixture graph (25 nodes: a linear auth/template
preamble, a retry loop — check point state, wait 30s, loop back — and two exits, success and
timeout):

1. **`elk.layered.feedbackEdges: true`** (one-line change to `ROOT_OPTS`, tested by editing
   `pbLayout.js` directly since there is no way to pass a layout option per-invocation). Empirically
   verified with a standalone `elkjs` script before touching the real graph: it does shorten the
   loop-closing edge and groups the loop's nodes into a band — but on the real 25-node graph it also
   **broke the main flow's left-to-right ordering** (`EG active?` landed at `x=794`, *before*
   `EG auth ok?` at `x=1071`, despite being topologically downstream). Net effect on the real graph:
   negative. Reverted (`git checkout -- src/agrippa/lib/pbLayout.js`).
2. **Hand-computed layout** (`layout`/`waypoints` written directly, via a throwaway Python script
   operating on the parsed YAML — exactly the workflow `CLAUDE.md` says not to do, done here only to
   produce something showable, not as a repeatable process). Worked, but took two iterations following
   human feedback ("elbow the diagonal lines," "END error should be above, not to the right") that a
   human would normally give an interactive editor, not a script re-run.
3. **Swapping which flow is `default`** at the two loop-control gateways (`EG active?`,
   `EG attempts exhausted?`) so the *exit* branches ("attivo", "esauriti") carry no condition and the
   *loop-continuation* branches carry the condition instead. This is BPMN-neutral (no behavior change,
   confirmed with `pb lint`) and, combined with `pb format`'s existing happy-flow heuristic (**no other
   change needed**), produced a straight, monotonically-increasing path all the way to `END success`
   — verified by reading the resulting `x` coordinates (`1556 → 1786 → … → 2218`).

Item 3 is the one existing lever that worked, and it worked *because* it's a graph-shape fix, not a
layout-algorithm fix — which is the throughline for what's proposed below: **give the human/agent
cheap, composable, non-destructive tools to describe the same kind of local intent** ("this is the
happy exit," "this node goes next to that one," "leave this cluster alone") instead of asking one
global algorithm to infer it, or asking a script to compute absolute coordinates.

## Proposed commands, in priority order

### 1. `--elk <key>=<value>` passthrough on `pb format` (do this first — near-zero cost)

```bash
agrippa pb format --pb W --elk elk.layered.feedbackEdges=true
agrippa pb format --pb W --elk elk.layered.cycleBreaking.strategy=MODEL_ORDER
```

Repeatable flag, merged into `ROOT_OPTS` before the `elk.layout()` call in `autoLayout` (`pbLayout.js`
line ~178: `layoutOptions: ROOT_OPTS` → `{ ...ROOT_OPTS, ...cliOverrides }`). No new concepts, no new
file format — just stops "try an ELK option" from requiring an edit to `prbot`'s own source and a
`git checkout` to undo it, which is what happened in this session. Directly enables safe experiments
like item 1 above without touching shared code. Should ship with a `--elk-help` or doc pointer to
[ELK's layered options reference], since the option names are not guessable.

**Risk:** a bad combination of options can make elkjs throw or hang (some interact). Wrap the `elk.layout()`
call so a passthrough-caused failure reports "your `--elk` options" plainly, not a raw stack trace.

### 2. `pb route --from A --to B` (or `--id <edgeId>`) — recompute one edge's waypoints

```bash
agrippa pb route --from ScriptTask_a --to ScriptTask_b --pb W
agrippa pb route --id SequenceFlow_xyz --pb W
```

Given the two nodes' **current, already-finalized** `layout` (does not touch either node's position),
compute a clean path and overwrite just that edge's `waypoints`:
- same `y` (or `x`, for a vertical relationship) within a small tolerance → straight 2-point line
  (mirrors what `connect`'s stub already does, but recomputed against *final*, not placeholder,
  positions);
- otherwise → an L-shaped 3-point elbow, exiting the source's nearest side (right/left/top/bottom
  toward the target) and entering the target's opposite side — i.e., exactly the `port()`/`route()`
  logic the throwaway Python script in this session implemented ad hoc (see the fixture's commit
  history in the workspace task, or reconstruct from this document's "port selection" sketch below).
- `--via x,y` optional override for an explicit bend point, for the rare case the heuristic guesses
  wrong.

This is the single highest-leverage addition for *manual* layout work specifically: today, moving one
node by hand (editing its `layout.x`/`.y`) leaves every attached edge's `waypoints` stale (pointing at
the old position) until the next full `pb format` — which then re-lays-out everything else too. `pb
route` lets a human/agent fix *just the edges touching a manually-moved node*, which is the actual
workflow this session needed three separate times (main spine, error-row, retry-loop row).

**Port selection sketch** (for whoever implements this — not a spec, a starting point validated
informally on the fixture):

```
dx = targetCenter.x - sourceCenter.x
dy = targetCenter.y - sourceCenter.y
if |dy| <= TOLERANCE:  straight line, right-center(source) -> left-center(target)  (or reversed if dx<0)
elif |dx| <= TOLERANCE: straight line, bottom-center(source) -> top-center(target) (or reversed if dy<0)
else: elbow — exit the source's side facing the target's general direction (dominant axis first),
      one bend point, enter the target's facing side
```

### 3. `pb move --id X --right-of/--left-of/--above/--below Y [--gap N]`

```bash
agrippa pb move --id ScriptTask_new --right-of ExclusiveGateway_g --gap 30 --pb W
```

Sets `X.layout.{x,y}` relative to `Y`'s **current** layout plus a gap (default gap: the existing
`elk.spacing.nodeNode` value, `80`, for consistency with what `pb format` itself would use), instead
of requiring the caller to add up `Y.x + Y.width + gap` by hand — small, but it's exactly the kind of
off-by-one-prone arithmetic a throwaway script had to redo three times this session. Should call `pb
route` internally (see above) for every edge touching `X`, so a `move` immediately leaves the diagram
edge-consistent instead of needing a follow-up pass.

### 4. `pb align --ids A,B,C --x|--y [--to <id>]`

```bash
agrippa pb align --ids ScriptTask_a,ScriptTask_b,ScriptTask_c --y --pb W
agrippa pb align --ids ExclusiveGateway_g,EndEvent_e --x --to ExclusiveGateway_g --pb W
```

Snaps every listed node's `x` (or `y`) to a common value — either the first id's, or an explicit
`--to <id>`. This is the "row/column" pattern used three times by hand in this session (the main
happy-path spine, the error-row nodes converging on one join gateway, the retry-loop row) — currently
requires computing and re-typing the same coordinate for every node in the group. Does **not**
re-route edges itself (run `pb route` per affected edge afterward, or fold both into one call if this
and #2 ship together — see "Sequencing," below).

### 5. Scoped/partial auto-layout — `pb format --only <ids>` / `--exclude <ids>` (highest effort, addresses the root cause)

```bash
agrippa pb format --pb W --only ExclusiveGateway_n7bdbhl,ServiceTask_ksy8g14,ScriptTask_efma59m,ExclusiveGateway_y8oecwu,ExclusiveGateway_2jhs7uf,IntermediateCatchEvent_or3jqzg
```

Run `autoLayout` on the **induced subgraph** of just the listed nodes (plus their connecting edges),
leave every other node's `layout` untouched, then splice the sub-result back in at an offset chosen to
not overlap the fixed nodes (simplest: place it below the fixed nodes' combined bounding box, or take
an explicit `--anchor x,y`). This is the only proposal here that would let a **cyclic** region (the
actual root cause of everything that went wrong in this session — a full-graph ELK layered pass simply
doesn't have a good answer for a cycle mixed with a long acyclic prefix and multiple side-branches) be
formatted in isolation, where ELK's cycle-breaking has a much smaller, more homogeneous graph to work
with and can't drag unrelated upstream/downstream nodes out of order.

**Open questions, not resolved here:**
- Edges crossing the `--only` boundary (e.g. `EG auth ok? → EG loop` in the fixture) need one endpoint
  pinned at its current absolute position for ELK to route against — elkjs supports fixed/external
  ports for exactly this, but wiring it up is real work, not a config flag.
- Where the sub-layout's origin lands relative to the rest of the diagram (auto-placed vs.
  `--anchor`) needs a decision informed by a few more real cases, not just this one.

This is explicitly the "if only one thing ships, and effort is not a constraint, ship this" item —
but #1 and #2 alone would have covered two of the three fixes made in this session (the ELK experiment
and the manual elbow-routing), at a fraction of the cost.

## Sequencing

1 and 2 are independent and can ship separately, in either order. 3 and 4 both benefit from 2 already
existing (so they can call it internally instead of leaving stale waypoints) but aren't blocked by it
— they could ship first and re-route naively (straight stub, like `connect` does today) until 2 lands.
5 is independent of the others and by far the largest lift; sequence it last unless a second real case
surfaces that specifically needs it.

## What this proposal does not include

- No implementation of any of the five commands.
- No decision on exact flag names/spelling — `--right-of`/`--left-of` etc. are illustrative, not final.
- No handling for `subProcess`/`transaction` containers beyond what `pb format` already does (ELK's
  `hierarchyHandling: INCLUDE_CHILDREN` should keep working for `--only` scoping, but this wasn't
  tested against a container-bearing fixture).
- No fix for the *specific* fixture graph included here — it already has a working hand-tuned layout
  (see `fixtures/case_await_point_active/structure.yaml`) and the `default`/condition swap described
  above already applied. The fixture is here to test *new commands* against a real graph with a real
  cycle, not to be fixed again.

## Fixture

`fixtures/case_await_point_active/` is a verbatim copy of the decomposed LRP project
`B2WA_case_await_point_active` from `sorgenia_workspace/src/`, as of 2026-09-08 (hand-tuned layout,
default/condition swap applied, `pb lint` clean). Not registered in any `agrippa.yaml` workspace —
`pbLayout.js`/`pbEdit.js`'s functions operate on the parsed `structure.yaml` object directly, so a
throwaway script (`yaml.safe_load` in Python, or the project's own `yaml` package in Node) is enough
to experiment against it without a live agrippa workspace. It has: a 9-node linear
auth/template preamble, a 3-way error fan-in to one join gateway, a 6-node retry loop with a timer
wait, and two separate exits (success, timeout) — enough shape to exercise all five proposed commands.
