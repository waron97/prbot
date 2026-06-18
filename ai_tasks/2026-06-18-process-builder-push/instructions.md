Building on the work in ai_tasks/2026-06-18-process-builder-clone, I want to implement dispatching the local work to the process builder api.

In the `payloads` folder, I included some useful usage exaples in the real world.

One thing to note: when updating user tasks (`pages` cloned folder) via UI, a popup comes up for the page, which the user updates.
After this, a "save" button is independently pressed for the page, which operates separately from the whole-wizard save.
Look out for this distinction in the example payload.

After saving, the wizard is in "draft" state, and needs to be optionally "published" thereafter for the modifications to be accessible in the live consumers of the wizard. Users of agrippa should have the option to publish the wizard after `agrippa push` uploaded the changes (cli prompt or --publish for auto publishing).

Odoo phases and MFAs use a checksum calculation to tell if the upstream was modified and the local is therefore stale.
Reason about this a little, but I have a hunch this is too complex for wizards.
In this case, we can just fall back to looking at the state of the upstream record: if "modified", agrippa alerts that conflicts are possible. Or we can look at last modified dates, if applicable.
At any rate, the backup function should hold for wizards: store the full payload of the upstream wizard before applying edits.


