# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo contains two CLI tools published as a single npm package (`@waron97/prbot`):

- **`prbot`** — automates PR workflows, changelogs, version bumps, and Odoo XML/data exports against an Azure DevOps + Odoo/RIP stack
- **`agrippa`** — syncs Odoo workflow phase Python code and Model Function Access (MFA) records between the local filesystem and the RIP API, tracking changes via checksums

Both are plain ESM JavaScript (no build step). Install globally with `npm install -g .` to get both binaries on `PATH`.

## Development commands

```bash
npm install -g .      # install/reinstall both CLIs from source
prbot init            # configure global credentials (~/.config/prbot/config)
```

There are no tests and no build step. Changes are live immediately after `npm install -g .`.

Linting:

```bash
npx eslint src/
npx prettier --check src/
npx prettier --write src/
```

## Architecture

### Shared config and auth

`src/config.js` exports `CONFIG_FILE` — the path to `~/.config/prbot/config` (dotenv KEY=VALUE format). This file is loaded by `src/index.js` via `configDotenv()` before any prbot command runs.

`src/lib/auth.js` exports `getToken()`, which does a Keycloak password-grant flow using `KC_*` env vars and returns a Bearer token. Both prbot and agrippa commands share this function directly.

`src/lib/fuzzy.js` exports `fuzzyMatch(str, query)` — simple character-subsequence matching used in all interactive search prompts across both tools.

### prbot

Entry point: `src/index.js` — registers Commander subcommands, calls `configDotenv` once at startup.

Key commands and what they touch:

- **`pr` / `export workflow`** (`src/commands/pr.js`, `exportWorkflow.js`) — POSTs to `RIP_URL/ir.model/xml_prbot`, writes XML to `ADDONS_PATH/config/<module>/data/`, commits via git
- **`autopr`** (`src/commands/autopr.js`) — orchestrates: branch creation, Azure DevOps PR via REST API, Trident task update via Odoo JSON-RPC, changelog write, git push. The Trident client uses `TRIDENT_URL/jsonrpc` with Odoo RPC protocol
- **`changelog`** (`src/commands/changelog.js`) — parses `CHANGELOG.md` by `### ` headings, scores sections against Trident task metadata, appends entries preserving indentation
- **`commit`** (`src/commands/commit.js`) — interactive staged-file selector + commit type picker
- **`export pb/imperex/email-templates`** (`src/commands/export*.js`) — hit `IMPORTEXPORT_URL` or `RIP_URL` endpoints, write results to paths under `ADDONS_PATH`

`src/lib/addons.js` — `resolveAddonsPath()` expands `~` in the configured path.
`src/lib/git.js` — `execGit(args, cwd)` promise wrapper around `execFile('git', ...)`.

### agrippa

Entry point: `src/agrippa/index.js` — separate Commander program, no shared entry point with prbot.

Config loading (`src/agrippa/lib/config.js`):

1. Calls `configDotenv({ path: CONFIG_FILE })` to load the global prbot config as base
2. Overlays any values from the `agrippa:` section of the local `agrippa.yaml`

This means agrippa reuses all KC/RIP credentials from `prbot init` by default — `agrippa.yaml` only needs entries when overriding workspace-specific values.

`agrippa.yaml` (created by `agrippa init` in CWD) tracks the workspace:

```yaml
agrippa: {} # optional credential overrides
workspace:
    - path: 'nuovo-allaccio/a1559-invio-alla-market-comm.py'
      id: 123
      object_type: 'phase' # or "mfa"
      checksum_at_pull: 'abc123...'
      name: 'ML - Nuovo Allaccio Ele / A1559 - Invio alla Market Comm'
```

Change detection uses three checksums — `checksum_at_pull` (stored), current local, current remote — to classify each entry as `unchanged`, `fast-forward` (safe overwrite), or `conflict` (data loss risk). The same logic runs in both `pull` and `push`, with the concern inverted.

`pull.js` exports `fetchRemoteCode` and `selectEntries` for reuse by `push.js`. The selection UI has two stages when records span multiple folders: folder-level checkbox first, then per-record fine-tuning.

`push` writes `.backup/<ISO-timestamp>/<original-path>` before overwriting any remote code.

API endpoints used by agrippa (`src/agrippa/lib/api.js`):

- `GET /symple.workflow/*` — list workflows
- `GET /symple.triplet.phase/*?_filter_=[...]` — phases by workflow or by ID list (Odoo domain syntax in URL, not encoded)
- `PUT /symple.triplet.phase/<id>` — update phase code
- `GET /symple.workflow/get_mfas` — list MFAs
- `POST /symple.workflow/update_mfa` — update MFA code

`workspace.js` slugification: workflow/phase paths use `slugify` with `strict: true` (dashes); MFA filenames use `replacement: '_'` (underscores) to match Odoo naming conventions.
