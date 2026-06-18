I want to extend `agrippa` to be able to work with process-builder projects. Process builer is a term we use to describe wizards developed in the project, which are essentially visual developments that live outside odoo.

A wizard is based on a bpmn-like design and development cycle, in a workflow that lives currently only in the browser. Agrippa would help with the latter point, allowing development to be carried out locally.

The list of wizards can be downloaded from https://sorgenia-test-02.symple.cloud/api/processbuilder/v1/builder/process, where the base url would be an env param and you pass it the same bearer token as import-export. The response is a list of processes, with relevant fields being {guid, process_name, document_id}.

- guid = technical id to be used in later api calls
- document_id = technical process_name
- process_name = human name

the document_id and human name is already thing when we do probot export pb, they are both shown in the selectable list.

Having selected the guid, we pass it to https://sorgenia-test-02.symple.cloud/api/processbuilder/v1/builder/process/<guid>, which returns the full body of the process_builder.
You have a few examples of responses in the task folder.

The goal for this task is to implement `agrippa clone` with the "pb" variant, so `agrippa clone --pb`. This would present a list of available wizards, but should also allow an additional argument to auto select by technical name, and should allow choosing the destination folder for the cloned process builder.

Now, the main challenge of this task is how to represent the wizard locally. I have given you an idea of mine in the task folder, but the way I see it currently, we would have a general `structure.yaml` that defines nodes and their connections, then two subfolders `pages` and `scripts`. `pages` would contain yaml breakdown of the user tasks in the page, and `scripts` would be the javascript file implementations.

Your job is to understand the "best" way to do this.
The idea, like with odoo-based workflows, is to have the user edit these files on the local machine, that have an agrippa utility recompose the modified files into a publishable artifact to send over the wire.
Actually publishing is deferred to another task, but for now, please prepare the utilities and validate them by making sure that you're able to reconstruct the original payload from the cloned files with 0 information loss.

External sources you may use:
- ~/codebase/sorgenia/b2w has processbuilder and processbuilder-runtime repos
- ~/codebase/sorgenia/sorgenia_workspace contains an agentic workflow that is able to work on process_builder objects but does so in a different way, its desired deliverable is a single insert.sql that would be run against the db to insert a newly-created wizard; this isn't what we're trying to do but there may be good notions there

Please generate in the task directory a `planning.md` and halt before proceeding with implementation, which should be tracked to `implementation.md` for notes and motivations for what was developed.

Please halt to ask questions if you're unsure about the requirement, the implemention of some feature of other, stylistic choices in how to decompose the wizard, or if some aspect of the process builder isn't clear.

You're encouraged to try to use the tool you're making. The examples I left you are all valid document_ids.
