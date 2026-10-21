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

`src/config.js` exports `CONFIG_FILE` — the path to `~/.config/prbot/config` (dotenv KEY=VALUE format), which always targets test-02. `src/lib/env.js` `loadConfigFiles(secretsFile, { isolateEnvKeys })` is the one loader both tools use: secrets file first, then the global config filling gaps (`configDotenv` never overwrites a set key, and the process env beats both). With `isolateEnvKeys` (prbot only), the environment-identifying keys (`ENV_SPECIFIC_KEYS`: `KC_*`, `RIP_URL`, `IMPORTEXPORT_URL`, `PB_URL`) are never taken from the global config when a secrets file is given, so a test-01 file can't half-target test-02; other keys (`ADDONS_PATH`, `TRIDENT_*`, `DEVOPS_*`) still fall back. `getToken()` fails with a clear message when any `KC_*` key is missing.

`src/lib/auth.js` exports `getToken()`, which does a Keycloak password-grant flow using `KC_*` env vars and returns a Bearer token. Both prbot and agrippa commands share this function directly.

`src/lib/fuzzy.js` exports `fuzzyMatch(str, query)` — simple character-subsequence matching used in all interactive search prompts across both tools.

### prbot

Entry point: `src/index.js` — registers Commander subcommands and loads config once at startup. The global `--secrets-file <path>` option (e.g. `~/.config/prbot/config.test-01`) is read straight from argv by `secretsFileFromArgv()`, because config must be in `process.env` before Commander parses; it works before or after the subcommand, and a stderr banner shows the RIP/ImportExport/PB hosts in use.

Key commands and what they touch:

- **`pr` / `export workflow`** (`src/commands/pr.js`, `exportWorkflow.js`) — POSTs to `RIP_URL/ir.model/xml_prbot`, writes XML to `ADDONS_PATH/config/<module>/data/`, commits via git
- **`autopr`** (`src/commands/autopr.js`) — orchestrates: branch creation, Azure DevOps PR via REST API, Trident task update via Odoo JSON-RPC, changelog write, git push. The Trident client uses `TRIDENT_URL/jsonrpc` with Odoo RPC protocol
- **`changelog`** (`src/commands/changelog.js`) — parses `CHANGELOG.md` by `### ` headings, scores sections against Trident task metadata, appends entries preserving indentation
- **`commit`** (`src/commands/commit.js`) — interactive staged-file selector + commit type picker
- **`export pb/imperex/email-templates`** (`src/commands/export*.js`) — hit `IMPORTEXPORT_URL` or `RIP_URL` endpoints, write results to paths under `ADDONS_PATH`
- **`import pb`** (`src/commands/importPb.js`) — POSTs a PB zip as base64 to `IMPORTEXPORT_URL/symphony/import`, polls `export/info/processKey=Import&...` by the returned `requestId` (WARNING = success + printed message; FAILED/hasError = error), then publishes the resulting draft wizard
- **`publish pb`** (`src/commands/publishPb.js`) — publishes a wizard via agrippa's `pbApi.js` (`PB_URL/builder/process/publish/<guid>`); `publishWizard` is shared with `import pb`
- **`import imperex`** (`src/commands/importImperex.js`) — POSTs the selected `sorgenia_imperex_metadata/migrations/0.0.0/imperex/<model>/*.yaml` as `{files: [{name, content}], dry_run}` to the custom MFA `RIP_URL/helpdesk.ticket/prbot_imperex_import`, which merges them and runs `imperex.import.do()` with no manifest (the environment's system manifest applies). The built-in `imperex.import/upload` is unusable: it passes a `clean_before` kwarg `do()` no longer accepts

Every selecting command must work both ways: CLI flags select records non-interactively (agents, no TTY — `requireInteractive()` from `src/lib/tty.js` fails fast naming the flag), and with no selector on a TTY it falls back to fuzzy search (`@inquirer/search`, or `fuzzyMultiSelect` from `src/lib/prompt.js` for multi-select). `--list`/`-Q` lets agents discover valid selector values.

`src/lib/addons.js` — `resolveAddonsPath()` expands a leading `~` in the configured path; an unset, empty, or `.` `ADDONS_PATH` falls back to `process.cwd()` (e.g. a git worktree). Either way, it then requires the resolved directory to contain both `.git` and `config/` — otherwise it throws rather than silently treating an unrelated directory as the addons checkout.
`src/lib/git.js` — `execGit(args, cwd)` promise wrapper around `execFile('git', ...)`.

### agrippa

Entry point: `src/agrippa/index.js` — separate Commander program, no shared entry point with prbot.

Config loading (`src/agrippa/lib/config.js`), via `loadEffectiveEnv(localConfig, secretsFile)`:

1. `--secrets-file <path>` — a global Commander option on `program` (`src/agrippa/index.js`), read via `program.opts().secretsFile` in each subcommand's action callback and threaded into the command function as `opts.secretsFile`. Loaded first via the shared `loadConfigFiles()` (`src/lib/env.js`, without `isolateEnvKeys`); a nonexistent `--secrets-file` path throws rather than being silently ignored.
2. The global prbot config (`CONFIG_FILE`, `~/.config/prbot/config`) — loaded second via `configDotenv({ path: CONFIG_FILE })`. `configDotenv` never overwrites a key already present in `process.env`, so whichever of the two sources set a given key first wins — i.e. `--secrets-file` takes priority per key, and the global config only fills gaps.

`agrippa.yaml`'s `agrippa:` block is no longer read for credentials at all — none of `KC_URL/KC_USER/KC_PASSWORD/KC_ID/KC_SECRET/RIP_URL/PB_URL` come from it anymore, so `agrippa.yaml` is pure resource inventory and safe to commit. If an existing file still has one of those keys set, `loadEffectiveEnv` prints a one-time warning (not an error) pointing at `--secrets-file`/the global config.

`agrippa.yaml` (created by `agrippa init` in CWD) tracks the workspace:

```yaml
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
