import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import { WORKSPACE_FILE } from '../lib/config.js';

const TEMPLATE = `# agrippa workspace configuration
# Keycloak and RIP credentials are taken from the global prbot config by default.
# Uncomment and set values here only to override them for this workspace.
agrippa: {}
  # KC_URL: ""
  # KC_USER: ""
  # KC_PASSWORD: ""
  # KC_ID: ""
  # KC_SECRET: ""
  # RIP_URL: ""

workspace: []
`;

const PYPROJECT_TOML = `[tool.ruff]
builtins = [
    "case_id",
    "request",
    "format_exc",
    "env",
    "log",
    "json_dumps",
    "ValidationError",
    "datetime",
    "date",
    "dateutil",
    "time",
    "pytz",
    "body",
    "make_response",
    "logger",
    "first",
    "args",
    "model",
    "json_loads",
    "record",
    "records"
]
`;

const PYRIGHTCONFIG =
    JSON.stringify(
        {
            pythonVersion: '3.10',
            stubPath: 'typings',
            typeCheckingMode: 'standard',
            reportArgumentType: 'none',
        },
        null,
        2
    ) + '\n';

const TYPING_FILES = [
    '__builtins__.pyi',
    'odoo_environment.pyi',
    'odoo_records.pyi',
    'recordset.pyi',
    'b2w_entities.pyi',
];

async function init() {
    if (existsSync(WORKSPACE_FILE)) {
        const { overwrite } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'overwrite',
                message: `${WORKSPACE_FILE} already exists. Overwrite?`,
                default: false,
            },
        ]);
        if (!overwrite) {
            console.log('Skipped workspace file.');
        } else {
            writeFileSync(WORKSPACE_FILE, TEMPLATE, 'utf-8');
            console.log(`Created ${WORKSPACE_FILE}`);
            console.log(`Run 'agrippa clone' to add resources to this workspace.`);
            console.log(`Add ${WORKSPACE_FILE} to .gitignore if it contains credentials.`);
        }
    } else {
        writeFileSync(WORKSPACE_FILE, TEMPLATE, 'utf-8');
        console.log(`Created ${WORKSPACE_FILE}`);
        console.log(`Run 'agrippa clone' to add resources to this workspace.`);
        console.log(`Add ${WORKSPACE_FILE} to .gitignore if it contains credentials.`);
    }

    if (!existsSync('pyproject.toml')) {
        writeFileSync('pyproject.toml', PYPROJECT_TOML, 'utf-8');
        console.log('Created pyproject.toml (ruff builtins)');
    }

    const { importTypings } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'importTypings',
            message: 'Import pyright config and type stubs?',
            default: true,
        },
    ]);

    if (importTypings) {
        if (!existsSync('pyrightconfig.json')) {
            writeFileSync('pyrightconfig.json', PYRIGHTCONFIG, 'utf-8');
            console.log('Created pyrightconfig.json');
        }

        const typingsDir = fileURLToPath(new URL('../../../agrippa_typings', import.meta.url));
        mkdirSync('typings', { recursive: true });
        for (const file of TYPING_FILES) {
            copyFileSync(join(typingsDir, file), join('typings', file));
        }
        console.log(`Copied ${TYPING_FILES.length} type stubs to typings/`);
    }
}

export { init };
