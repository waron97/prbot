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

