# Response to the readiness spec (2026-07-18)

Addressed to whoever needs the scope decision: the analyst, the team, CI/CD owners.

## Verdict

The spec's code-level findings are accurate. Every claim I checked was verified directly
against the current source (commit `731889f`, package `3.3.0`) — `--silent` swallowing
errors, `routine` printing `Failed` and continuing, no `parseAsync`/central error handler,
auth returning an unvalidated token, the PB export poll having no deadline, Agrippa
conflicts being preselected and pushable, no test suite, no `engines`. Good, grounded
research — thank you for that.

The proposed scope, though, is a different and much larger tool: release manifests, a
read-only planner, isolated staging builds with exact-diff, a persistent journal/state
machine, a pipeline adapter, an environment contract, promotion, rollback, a capability
system, secret-store integration, evidence reports. 50 requirements, 18 PR batches. That's
not what gets built next.

## What's happening now

A hardening batch covering the correctness bugs and cheap, dependency-free improvements —
no external contracts required:

- `--silent` no longer swallows errors (renamed to `--quiet`; `--silent` kept as a
  deprecated alias). An export can no longer fail and still report success.
- `routine` aggregates step failures into a non-zero exit instead of printing `Failed` and
  moving on.
- `program.parseAsync()` + a single top-level error handler; `unhandledRejection` /
  `uncaughtException` now fail loudly instead of silently.
- `auth.js` validates HTTP status and the presence of `access_token` before returning it —
  no more `Bearer undefined` propagating downstream.
- The Process Builder export poll now has an overall deadline (previously unbounded).
- Agrippa conflict entries are no longer preselected in the pull/push checkbox, and a new
  `--non-interactive` flag refuses to proceed if any candidate is in conflict — paired with
  a checksum canonicalization fix (reusing the existing `normalizeProcessTree`/
  `diagramGeometry` semantic-diff primitives) so a clean re-push no longer shows a phantom
  conflict. Shipping the block without the canonicalization fix would have broken
  legitimate re-pushes, exactly as your own `deferred_work.md` flagged.
- Purely local commands (`init`, `ver`, `commit`, `changelog`) no longer carry Keycloak/
  DevOps/Trident credentials in their process env; `PRBOT_OFFLINE=1`/`--offline` skips the
  update-check network call.
- `package.json` now declares `engines.node`/`packageManager`; `prbot update [version]`
  takes an explicit version instead of always resolving `latest`.

This corresponds to the spec's own §12 step 1 ("CLI affidabile e pacchetto tracciabile")
plus the auth and conflict-detection fixes — roughly Lotto 1–2, minus the full test/CI
buildout.

## What's declined, for now

The release-governance layer — manifests, `release plan/build`, staging + exact-diff, the
journal/state machine, the pipeline adapter, the environment contract, promotion, rollback,
the capability system, secret-store integration, evidence reports, the agent operating
contract. Two reasons:

1. It's a materially different tool from what PRbot/Agrippa are today, and building it
   speculatively — before it's proven the smaller hardening actually holds up in daily use
   — front-loads a lot of risk.
2. Roughly half of it is blocked on external contracts the spec itself lists in Appendix G
   (`EXT-001`…`EXT-017`): pipeline IDs and parameters, environment mapping, the secret
   store and technical identity, LRP/PB/Imperex API stability, who approves what. None of
   that can be built without inventing behavior that isn't backed by a real contract.

If/when those owners supply the contracts, the deployment/promotion requirements
(`REL-DEP-*`, `REL-ROLL-001`) are the natural next phase to revisit — not before.

## Natural next step after this batch

A real test/CI baseline (`REL-TST-001`-equivalent): an actual `npm test`, green
eslint/prettier, and CI on every PR. That's foundational for everything else in the spec
and isn't blocked on anyone — it's just its own, separately-scoped piece of work.
