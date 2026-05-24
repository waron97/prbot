# prbot

CLI tool for managing PRs, changelogs, and Odoo workflow XML files in the addons repo.

## Install

```bash
npm install -g .
```

## Setup

```bash
prbot init
```

Prompts for all required config values and writes them to `~/.config/prbot/config`. Run once, re-run anytime to update config.

### Config keys

| Key                    | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `ADDONS_PATH`          | Path to local Odoo addons repo                           |
| `KC_URL`               | Keycloak token endpoint URL                              |
| `KC_USER`              | Keycloak username                                        |
| `KC_PASSWORD`          | Keycloak password                                        |
| `KC_ID`                | Keycloak client ID                                       |
| `KC_SECRET`            | Keycloak client secret                                   |
| `RIP_URL`              | RIP API base URL                                         |
| `TRIDENT_URL`          | Trident (Odoo) instance URL                              |
| `TRIDENT_UID`          | Trident user ID                                          |
| `TRIDENT_TOKEN`        | Trident API token                                        |
| `TRIDENT_DB`           | Trident database name                                    |
| `DEVOPS_TOKEN`         | Azure DevOps personal access token                       |
| `DEVOPS_ORG`           | Azure DevOps organization                                |
| `DEVOPS_PROJECT`       | Azure DevOps project                                     |
| `DEVOPS_REPO`          | Azure DevOps repository name                             |
| `AUTOPR_TARGET_BRANCH` | Target branch for auto-created PRs (default: `15.0-dev`) |
| `IMPORTEXPORT_URL`     | ImportExport API base URL                                 |

## Commands

### `prbot pr <module>`

Fetches workflow XML for `<module>` from RIP, writes files into `ADDONS_PATH/config/<module>/data/`, and commits.

```bash
prbot pr config_wf_contestazione
```

Options:

| Flag                 | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `-b, --bump <level>` | Also bump manifest version after commit. Level: `major`, `minor`, `patch` |

```bash
prbot pr config_wf_contestazione -b minor
```

### `prbot ver <module>`

Bumps the version in `__manifest__.py` for `<module>` and commits.

```bash
prbot ver config_wf_contestazione --bump patch
```

### `prbot changelog <pr>`

Writes a changelog entry into `CHANGELOG.md` for a given PR number. Prompts to select the target section, detects existing indentation, and appends the entry with refs.

```bash
prbot changelog 42 -m "Fix invoice state race condition" -t 1234 -t 5678 -j TESTML-1 -j TESTML-2
```

Options:

| Flag                   | Description                                   |
| ---------------------- | --------------------------------------------- |
| `-m, --message <text>` | Changelog entry message (prompted if omitted) |
| `-t, --trident <code>` | Trident issue code (repeatable)               |
| `-j, --jira <code>`    | JIRA issue code (repeatable)                  |

### `prbot autopr`

End-to-end PR automation: creates a branch, pushes it, opens a draft PR on Azure DevOps, appends the PR link to each Trident task's release checklist, writes a changelog entry, commits, and pushes.

```bash
# Single Trident task
prbot autopr -t 1234

# Multiple Trident tasks (all get PR link; first with work package drives section matching)
prbot autopr -t 1234 -t 5678

# Multiple Trident + multiple JIRA
prbot autopr -t 1234 -t 5678 -j TESTML-1 -j TESTML-2

# JIRA only — skips all Trident fetch/write operations
prbot autopr -j JIRA-99 --branch my-branch
```

Options:

| Flag                   | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `-t, --trident <id>`   | Trident task ID (repeatable)                                             |
| `-j, --jira <code>`    | JIRA issue code (repeatable)                                             |
| `-m, --message <text>` | Changelog entry message (prompted if omitted)                            |
| `-b, --branch <name>`  | Branch name (default: `autopr_<first-task-id>` or `autopr_<first-jira>`) |
| `-n, --name <text>`    | PR title (default: Trident task name)                                    |

### `prbot commit`

Interactive commit builder. Prompts for operation type (`[IMP]`, `[FIX]`, etc.), and a message. The destinatin module will be automatically detected. If nothing is staged, shows unstaged files and lets you select which to stage first. Previews the final commit message before confirming.

```bash
prbot commit
```

### `prbot export workflow`

Fetches workflow XML for an interactively selected module from RIP and commits. Prompts to select the module (from `ADDONS_PATH/config/` directories) via fuzzy search.

```bash
prbot export workflow
prbot export workflow --no-commit
```

Options:

| Flag          | Description              |
| ------------- | ------------------------ |
| `--no-commit` | Skip the git commit step |

### `prbot export pb`

Exports a Process Builder process from the ImportExport API and writes the ZIP to `ADDONS_PATH/.cloudbuild/pb/B2WA/processes/`. Updates the file in place if it already exists, otherwise writes to the `all/` subdirectory. Prompts to select the process via fuzzy search.

```bash
prbot export pb
prbot export pb --no-commit
```

Options:

| Flag          | Description              |
| ------------- | ------------------------ |
| `--no-commit` | Skip the git commit step |

### `prbot export imperex`

Exports a single Imperex record from Odoo via RIP and writes the resulting YAML into `ADDONS_PATH/sorgenia_imperex_metadata/migrations/0.0.0/imperex/<model>/`. Prompts first for the model (from local folder names), then for the record (fetched from API). Both prompts support fuzzy search.

```bash
prbot export imperex
prbot export imperex --no-commit
```

Options:

| Flag          | Description              |
| ------------- | ------------------------ |
| `--no-commit` | Skip the git commit step |

### `prbot export email-templates`

Fetches email templates for an interactively selected workflow from RIP and writes them as `ADDONS_PATH/config/<module>/data/mail_templates.xml`. Prompts first for the module (from `ADDONS_PATH/config/` directories), then for the workflow. Both prompts support fuzzy search.

```bash
prbot export email-templates
prbot export email-templates --no-commit
```

Options:

| Flag          | Description              |
| ------------- | ------------------------ |
| `--no-commit` | Skip the git commit step |

### `prbot init`

Interactive setup: writes `~/.config/prbot/config`.

### `prbot update`

Reinstalls the latest published version from npm.

```bash
prbot update
```

---

## agrippa

Syncs Odoo workflow phase Python code and MFA records between the local filesystem and the RIP API. Tracks changes via checksums and detects conflicts before overwriting.

Credentials are inherited from the global prbot config (`~/.config/prbot/config`). Override per-workspace in `agrippa.yaml`.

### `agrippa init`

Creates `agrippa.yaml` in the current directory. Always writes `pyproject.toml` with the standard ruff builtins. Optionally writes `pyrightconfig.json` and copies type stubs into `typings/`.

```bash
agrippa init
```

### `agrippa clone`

Clones all `from_code` phases for a selected workflow, or a single MFA, into the workspace. Writes files to disk and registers them in `agrippa.yaml`.

```bash
agrippa clone
agrippa clone --phase
agrippa clone --mfa
agrippa clone --phase --id 123 --path my-workflow/
```

Options:

| Flag            | Description                                              |
| --------------- | -------------------------------------------------------- |
| `--phase`       | Clone a phase (select a workflow)                        |
| `--mfa`         | Clone an MFA record                                      |
| `--id <id>`     | Skip selection, clone by ID                              |
| `--path <path>` | Destination path (base dir for phases, file path for MFA)|

### `agrippa pull`

Fetches remote code for all tracked entries and shows what changed. Classifies each as `fast-forward` (safe overwrite) or `conflict` (local edits would be lost). Lets you select which to pull.

After pulling, also checks tracked workflows for newly added `from_code` phases and auto-clones any not yet present locally.

```bash
agrippa pull
```

### `agrippa push`

Pushes local file changes back to RIP. Backs up current remote code to `.backup/<timestamp>/` before overwriting. Same conflict detection as pull, with the concern inverted.

```bash
agrippa push
```

### `agrippa diff [path]`

Shows a diff between local files and remote code. Optionally filter to a specific file path.

```bash
agrippa diff
agrippa diff my-workflow/some-phase.py
```

### `agrippa init-phase`

Selects a workflow and any phase, then pushes a default code scaffold to that phase on RIP. Sets `set_result_automatically` to `from_code`, generates result variable constants from the phase's allowed results, and creates the corresponding `result.code.configurator` records.

```bash
agrippa init-phase
```

### `agrippa repair`

Removes entries from `agrippa.yaml` whose local files no longer exist on disk.

```bash
agrippa repair
```

