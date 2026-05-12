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

Prompts for all required config values, writes them to `~/.config/prbot/config`, installs shell tab completion, and patches `~/.bashrc`. Run once, re-run anytime to update config.

After first run:

```bash
source ~/.bashrc
```

### Config keys

| Key | Description |
|-----|-------------|
| `ADDONS_PATH` | Path to local Odoo addons repo |
| `KC_URL` | Keycloak token endpoint URL |
| `KC_USER` | Keycloak username |
| `KC_PASSWORD` | Keycloak password |
| `KC_ID` | Keycloak client ID |
| `KC_SECRET` | Keycloak client secret |
| `RIP_URL` | RIP API base URL |
| `TRIDENT_URL` | Trident (Odoo) instance URL |
| `TRIDENT_UID` | Trident user ID |
| `TRIDENT_TOKEN` | Trident API token |
| `TRIDENT_DB` | Trident database name |
| `DEVOPS_TOKEN` | Azure DevOps personal access token |
| `DEVOPS_ORG` | Azure DevOps organization |
| `DEVOPS_PROJECT` | Azure DevOps project |
| `DEVOPS_REPO` | Azure DevOps repository name |
| `AUTOPR_TARGET_BRANCH` | Target branch for auto-created PRs (default: `15.0-dev`) |

## Commands

### `prbot pr <module>`

Fetches workflow XML for `<module>` from RIP, writes files into `ADDONS_PATH/config/<module>/data/`, and commits.

```bash
prbot pr config_wf_contestazione
```

Options:

| Flag | Description |
|------|-------------|
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

| Flag | Description |
|------|-------------|
| `-m, --message <text>` | Changelog entry message (prompted if omitted) |
| `-t, --trident <code>` | Trident issue code (repeatable) |
| `-j, --jira <code>` | JIRA issue code (repeatable) |

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

| Flag | Description |
|------|-------------|
| `-t, --trident <id>` | Trident task ID (repeatable) |
| `-j, --jira <code>` | JIRA issue code (repeatable) |
| `-m, --message <text>` | Changelog entry message (prompted if omitted) |
| `-b, --branch <name>` | Branch name (default: `autopr_<first-task-id>` or `autopr_<first-jira>`) |
| `-n, --name <text>` | PR title (default: Trident task name) |

### `prbot init`

Interactive setup: writes `~/.config/prbot/config` and installs shell completion.

## Tab completion

After `prbot init` and sourcing `~/.bashrc`, `<module>` arguments autocomplete from directories in `ADDONS_PATH/config/`.

```
prbot pr config_wf_<TAB>   # lists all workflow modules
```
