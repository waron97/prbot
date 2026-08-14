---
name: agrippa
description: Explore Sorgenia's Odoo process-builder wizards and long-running processes (LRPs) — the BPMN-based guided flows and background processes that live alongside the helpdesk.ticket cases the crm-navigation skill covers — via the `agrippa` CLI, for Aron. Use when Aron asks to "look at this wizard/LRP", "what does process X do", "show me the nodes/flow of wizard Y", "clone this process-builder wizard/LRP", "diff/pull this workflow phase or MFA", "find a phase/MFA/wizard/LRP by name", or similar exploration of agrippa-tracked Odoo resources (workflow phases, Model Function Access records, process-builder wizards, LRPs). Unlike crm-navigation (which reads/writes live case, contract, and Bit2win REST data), this skill is read/explore-only by design: it runs `agrippa clone`, `agrippa pull`, `agrippa diff`, and `agrippa pb ls`/`pb preview` freely, but NEVER runs `agrippa push`, `agrippa restore`, or any `agrippa pb` structural-edit command (add/rm/connect/disconnect/set-default/format) without Aron's explicit, per-invocation go-ahead — those write to the server or can discard local edits.
---

# agrippa

## What this is

This skill folder **is** the `@waron97/prbot` git repo (symlinked into
`~/.claude/skills/agrippa`), the source of the `agrippa` CLI. Use the
globally-installed `agrippa` binary if it's on PATH — that's the normal case
on this machine and is kept up to date independently. Only if `agrippa`
isn't found, fall back to running this checkout directly as a plain Node
script:

```bash
if command -v agrippa >/dev/null 2>&1; then
    AGRIPPA=agrippa
else
    AGRIPPA="node ~/.claude/skills/agrippa/src/agrippa/index.js"
fi
$AGRIPPA <command> [options]
```

Pairs with the `crm-navigation` skill: that one covers live case/contract/Bit2win
data across test-01/test-02; this one covers the process-definition side of the
same CRM — phases, MFAs, process-builder wizards, and LRPs tracked by `agrippa`.

## Credentials

`.env` next to this file is a symlink to `~/.config/prbot/config` — never ask
Aron for these, never print the token/values. Every invocation passes
`--secrets-file ~/.claude/skills/agrippa/.env` explicitly, even though on this
machine it resolves to the same file agrippa would fall back to anyway — this
keeps the skill self-contained if the fallback path or precedence ever changes.

## The workspace directory

Every `agrippa` command (except `init`) requires an `agrippa.yaml` file in the
CURRENT WORKING DIRECTORY. This skill has no dedicated persistent workspace —
create a throwaway one under `/tmp` per request instead:

```bash
mkdir -p /tmp/agrippa-scratch && cd /tmp/agrippa-scratch
$AGRIPPA init --non-interactive
```

This just writes a bare `agrippa.yaml` (or no-ops if one's already there) —
no typings/eslint/`npm install`/CLAUDE.md side effects — and is safe to run
freely. Reuse the same `/tmp/agrippa-scratch` directory for the rest of a
given request/conversation so cloned entries accumulate instead of vanishing
between commands; there's no need to preserve it across sessions. Don't run
plain `agrippa init` here — it's four sequential interactive confirm prompts,
one of which runs a blocking `npm install`, with no way to skip them.

If Aron explicitly points you at a different, already-tracked workspace (e.g.
an addons checkout that has its own `agrippa.yaml`), use that directory
instead for that request.

## Safety posture — reads vs writes

Reads never touch the server and run freely: `agrippa clone` (including
`--list`), `agrippa pull`, `agrippa diff`, `agrippa pb ls`, `agrippa pb preview`.

Writes need Aron's explicit go-ahead **for that specific invocation** — a
prior yes doesn't carry forward: `agrippa push`, `agrippa restore`, and every
`agrippa pb` structural-edit subcommand (`add`/`rm`/`connect`/`disconnect`/
`set-default`/`format`). For the full write/editing workflow, see
`~/.claude/skills/agrippa/agrippa-pb.md` rather than duplicating it here.

## Commands for exploring wizard/LRP data

`cd` into the scratch workspace first, resolve `$AGRIPPA` as above.
Always pass an explicit `--id`/`--name` — never leave it to interactive
fuzzy-search, which hangs with no TTY. Always pass `--non-interactive` to
`pull`, so a conflict fails loudly instead of prompting.

```bash
ENV=~/.claude/skills/agrippa/.env

# Find a resource without cloning it
$AGRIPPA clone --secrets-file $ENV --phase --list -Q <query>
$AGRIPPA clone --secrets-file $ENV --mfa   --list -Q <query>
$AGRIPPA clone --secrets-file $ENV --pb    --list -Q <query>
$AGRIPPA clone --secrets-file $ENV --lrp   --list -Q <query>

# Clone it to inspect contents (--path may be omitted safely)
$AGRIPPA clone --secrets-file $ENV --phase --id <id>
$AGRIPPA clone --secrets-file $ENV --mfa   --id <id>
$AGRIPPA clone --secrets-file $ENV --pb    --name <document_id>
$AGRIPPA clone --secrets-file $ENV --lrp   --name <name>

# Explore a cloned wizard/LRP's structure
$AGRIPPA pb ls      --secrets-file $ENV --pb <document_id_or_name>
$AGRIPPA pb preview --secrets-file $ENV --pb <document_id_or_name> --out /tmp/preview.svg

# Check for upstream changes / re-sync
$AGRIPPA pull --secrets-file $ENV --non-interactive
$AGRIPPA diff --secrets-file $ENV [target] [--json]
```

## Relation to crm-navigation

A case's workflow/phase id (from `crm-navigation`) is what this skill's
`--phase --id`/`--list -Q` would target if Aron wants to inspect the
underlying phase code behind a case's current stage.

## Maintenance

This checkout is the live `prbot` git repo — `git pull` here keeps it current
same as any other clone. The global `agrippa` install (used whenever it's on
PATH) is a separate `npm install -g .` and isn't managed by this skill.
