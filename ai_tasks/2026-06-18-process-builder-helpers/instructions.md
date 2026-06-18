This is step 3 following:

- 2026-06-18-process-builder-clone/
- 2026-06-18-process-builder-push/

The objective of this final task is implementing the helper utilities.

## Formatting

`agrippa pb format --pb [document id resolved from config]`

If --pb not selected, prompt for it.
This utility should automatically format a wizard, ideally using an off-the-shelf formatting tool like Elk.
Start block should be on the left, end block should be on the right.
Element sizes are {width, height} are pre-defined for most blocks, except arrows (SequenceFlow, one-dimensional) and embedded subprocesses (which adapt to their contents).

For the latter, you need to think quite a bit.
My idea is that a formatting pass should be independently carried out on subprocess contents, then it should be treated as a singular block in the global formatting pass.
You'll have to also figure out the frame for good {x, y} values for elements.
Angles in arrows might also be a challenge.
A good default approach is that they should have a single 90 degree angle if the connected blocks are not in one single line.

## Adding, removing, connecting blocks

I would like to have a brainstorming session about this for a minute before deciding the commands and intended behavior.
My assumption is that the consumer of these commands will be mostly AI agents.
The idea is that human users will most often add/remove blocks from the ui, since that's already a good way of doing it.
However, the other way this could happen is that an AI is asked to add or update a block group.
In this case, I wonder if the AI is good to update the yaml, or it should have cli helpers so it doesn't get lost in the yaml structure.
So the helpers here should give the AI opportunity to add, remove and connect blocks without having to deal with multi-thousand line YAML files.
It will eventually have to do that of course if edits are in order, but at least the part of creating blocks and making the connections is abstracted away.
Help me think about this and figure out the best way forward.
