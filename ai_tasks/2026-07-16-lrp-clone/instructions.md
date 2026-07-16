I want to implement the agrippa cloning/handling of LRPs. Some interaction with these guys are in import/export too. Structurally, long running processes are very similar to process builders, with the notable exception that the API bindings are different and they cannot have pages (user tasks).

I have copied a save and deploy calls into save.txt and deploy.txt, however beware they are quite large.

Broadly speaking, I want the agrippa utility to be the same between PBs and LRPs whenever possible so as not to maintain two very similar codebases.

As a reminder, beware that the id may change between saves, so agrippa cannot track LRPs by id, instead it must do so by name. Explore well and make sure to ask follow-up questions. You can also use the prbot/agrippa credentials configured on this machine to ping the api (READs only, no writes) to inspect data shape.

---

Follow-up notes given mid-session:

- "the browser uses cookie auth, however you should be able to use keycloak with bearer just like in import/export" — confirmed correct, live-tested.
- "there are more block types that are commonly used in LRPs that you may not find in PBs. `../../sorgenia_workspace/` has a rich corpus already" — this became the primary verification method (see implementation.md).
- "agrippa pb * commands should be in scope of the change" — the local `pb format/add/rm/connect/...` editing suite needed to work on LRPs too, not just clone/pull/push (this was almost missed — plan mode's first draft scoped it out as an "optional follow-up" before this correction).
- "pb subcommands: reuse pb group is fine, but `--pb <name>` should remain as the selector for LRPs also. workspace.yml has the info to disambiguate" — resolved the naming question for the shared editing CLI.
- "if possible, let's make sure that process builders were not impacted by the changes" / "best way is probably to search for agrippa workspaces with cloned process builders" — led to live-testing every real, currently-cloned PB wizard across every `agrippa.yaml` found on the machine.
- "we could probably suppress that warning for LRPs then, if it's just noise" — re: the expected `pages: undefined != object` round-trip diff on every LRP clone (LRPs have no pages at all).
- "let's also try a few complex LRPs for a static sanity check: B2WA_ml_IFS_passthrough, B2WA_SRG_OM_SYM_ORDERITEM, B2WA_ml_fiber_activation_migration_FW" — additional live spot-checks beyond the corpus.
- "please track everything that was done in this session in @ai_tasks/" — this document.
