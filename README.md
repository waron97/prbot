# prbot

CLI tool for fetching Odoo workflow XML files from the RIP API, writing them into the addons repo, and committing the result.

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

### `prbot init`

Interactive setup: writes `~/.config/prbot/config` and installs shell completion.

## Tab completion

After `prbot init` and sourcing `~/.bashrc`, `<module>` arguments autocomplete from directories in `ADDONS_PATH/config/`.

```
prbot pr config_wf_<TAB>   # lists all workflow modules
```
