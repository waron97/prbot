# Implementation notes — `agrippa pb` helper utilities (step 3)

See `planning.md` for the agreed design + decisions. This file = what was built.

## What shipped

A new `pb` subcommand group on the agrippa CLI — all **local-only** (no network);
they operate on a cloned, decomposed wizard and resolve the project dir from the
workspace by `document_id` (`--pb`), single-entry auto-select, or fuzzy prompt.

| command                                                           | does                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pb format`                                                       | auto-lays-out the diagram (elkjs, left→right) and rewrites `layout`/`waypoints` in structure.yaml       |
| `pb add --type T [--name] [--parent id]`                          | adds a node; scaffolds script/page + manifest entry; stub geometry                                      |
| `pb rm --id ID`                                                   | removes node (+ container children), its edges, inbound danglers, script/page files, manifest entries   |
| `pb connect --from A --to B [--name] [--condition E] [--default]` | adds a sequenceFlow; enforces the exclusiveGateway default/condition rule (warns)                       |
| `pb disconnect --id E` / `--from --to`                            | removes a sequenceFlow                                                                                  |
| `pb ls`                                                           | flat node/edge dump with ids, `[default]`, conditions — lets an agent navigate without reading the YAML |
| `pb preview [--out f.svg]`                                        | renders the diagram to SVG (dev check of format output)                                                 |

Agent loop: `pb ls` → `pb add` / `pb connect` → `pb format` → `agrippa push`.

## Files added / changed

- `src/agrippa/lib/pbEdit.js` — pure graph mutations over the structure.yaml object:
  `addNode`, `removeNode`, `connect`, `disconnect`, `listGraph`, `lintGateways`,
  id-gen, `findNode`, shared `SIZE`/`CONTAINER`/`eachNode`. Returns file
  side-effects (writes/deletes) + manifest mutation; no IO.
- `src/agrippa/lib/pbLayout.js` — `autoLayout(structure)` via **elkjs**
  (`layered`, `direction=RIGHT`, ortho routing, `hierarchyHandling=INCLUDE_CHILDREN`).
- `src/agrippa/lib/pbPreview.js` — `toSvg(structure)`, dependency-free.
- `src/agrippa/commands/pb.js` — orchestration (resolve project, load/save, validate).
- `src/agrippa/index.js` — registers the `pb` group.
- `src/agrippa/lib/pbProject.js` — now exports `stringifyStructure` + `pad` for reuse.
- `package.json` — `elkjs` dependency.

## Decisions (confirmed) and where they landed

1. **Structural-only helpers** — content edits stay raw-YAML. ✔
2. **`pb` subcommand group** (matches the `pb format` instruction syntax). ✔
3. **Stub geometry + require `format`** — `add`/`connect` write correct size and
   placeholder position/straight-line waypoint so the project stays recompose-valid;
   `format` finalizes. ✔
4. **elkjs** layout engine. ✔ (added user-requested mid-build: `pb preview` SVG.)
5. **exclusiveGateway rule** (added mid-build per user): a gateway with >1 outgoing
   flow must have exactly one `default` and a condition on every other. `connect`
   warns on violation; `lintGateways` also runs in `format`; `ls` shows `[default]`.

## elkjs coordinate handling (the two gotchas)

- **Node coords are parent-relative** → accumulated to absolute (BPMN bounds are
  absolute even for subProcess children).
- **Edge section coords are relative to the endpoints' lowest common ancestor (LCA)
  container** — _not_ always root. Verified empirically: a flow between two nodes
  inside the same subProcess comes back in SUB-relative coords; a flow crossing into
  the subProcess comes back root-relative. `autoLayout` computes each edge's LCA from
  the container path and offsets waypoints by that container's absolute origin.
- **boundaryEvent** has no ELK port concept here → post-pass snaps it onto its
  `attachedToRef` task's bottom border.

## Validation (all green)

- **format round-trip** on the real clone `ml_cessazioni_point_selection`:
  `compareProcess(before, after)` = **null** (logic untouched), diagram geometry
  changes as expected, all 24 shapes + 30 edges regenerated. `preview.png` in this
  folder is that formatted output (clean left→right: Start left, End right,
  subprocess/annotation/gateways rendered).
- **structural ops** (live CLI on a workspace copy): `add scriptTask` (next seq file),
  `add userTask` (page file + manifest entry), `add subProcess` + `add --parent`
  (nesting), `connect`, `disconnect --from/--to`, `rm` (page file + manifest removed,
  danglers dropped). Project recomposes cleanly after each.
- **gateway rule**: a bare 2nd outgoing flow from a gateway warns
  ("non-default flow without a condition expression"); `ls` marks `[default]`.
- **lint**: `eslint src/agrippa/...` → 0 errors (only the repo-wide `no-console`
  warnings shared by every command). Prettier can't run — the repo's prettier config
  references an uninstalled plugin (`@ianvs/prettier-plugin-sort-imports`),
  pre-existing; new code matches the 4-space house style by hand.

## Deferred / notes

- `pb preview` is a dev aid, not byte-faithful to the BPMN renderer.
- Geometry stubs from `add`/`connect` are intentionally crude; always run `pb format`.
- `process_structure` regeneration still deferred (server regenerates on publish).
