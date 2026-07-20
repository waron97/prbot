import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import { log } from '../../lib/logger.js';
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

// The copied guidance is wrapped in these sentinels so a re-run can find the
// managed block and refresh it in place (when agrippa-pb.md changes) without
// touching the human's own CLAUDE.md content outside the markers.
const PB_BEGIN = '<!-- BEGIN agrippa-pb guidance (managed by `agrippa init`) -->';
const PB_END = '<!-- END agrippa-pb guidance -->';

// Wrap the guide in the managed block.
function pbBlock(guide) {
    return `${PB_BEGIN}\n\n${guide.trimEnd()}\n\n${PB_END}\n`;
}

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
            log('Skipped workspace file.');
        } else {
            writeFileSync(WORKSPACE_FILE, TEMPLATE, 'utf-8');
            log(`Created ${WORKSPACE_FILE}`);
            log(`Run 'agrippa clone' to add resources to this workspace.`);
            log(`Add ${WORKSPACE_FILE} to .gitignore if it contains credentials.`);
        }
    } else {
        writeFileSync(WORKSPACE_FILE, TEMPLATE, 'utf-8');
        log(`Created ${WORKSPACE_FILE}`);
        log(`Run 'agrippa clone' to add resources to this workspace.`);
        log(`Add ${WORKSPACE_FILE} to .gitignore if it contains credentials.`);
    }

    if (!existsSync('pyproject.toml')) {
        writeFileSync('pyproject.toml', PYPROJECT_TOML, 'utf-8');
        log('Created pyproject.toml (ruff builtins)');
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
            log('Created pyrightconfig.json');
        }

        const typingsDir = fileURLToPath(new URL('../../../agrippa_typings', import.meta.url));
        mkdirSync('typings', { recursive: true });
        for (const file of TYPING_FILES) {
            copyFileSync(join(typingsDir, file), join('typings', file));
        }
        log(`Copied ${TYPING_FILES.length} type stubs to typings/`);
    }

    const { importInstructions } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'importInstructions',
            message: 'Copy agrippa-pb.md guidance into local CLAUDE.md?',
            default: true,
        },
    ]);

    if (importInstructions) {
        const guidePath = fileURLToPath(new URL('../../../agrippa-pb.md', import.meta.url));
        const block = pbBlock(readFileSync(guidePath, 'utf-8'));
        if (!existsSync('CLAUDE.md')) {
            writeFileSync('CLAUDE.md', block, 'utf-8');
            log('Created CLAUDE.md with agrippa-pb guidance');
        } else {
            const current = readFileSync('CLAUDE.md', 'utf-8');
            const begin = current.indexOf(PB_BEGIN);
            if (begin === -1) {
                appendFileSync('CLAUDE.md', `\n${block}`, 'utf-8');
                log('Appended agrippa-pb guidance to CLAUDE.md');
            } else {
                // Replace the existing managed block in place; leave the rest as-is.
                const endIdx = current.indexOf(PB_END, begin);
                if (endIdx === -1)
                    throw new Error(
                        'CLAUDE.md has a malformed agrippa-pb block (BEGIN without END) — fix it by hand.'
                    );
                const after = current.slice(endIdx + PB_END.length).replace(/^\n/, '');
                writeFileSync('CLAUDE.md', current.slice(0, begin) + block + after, 'utf-8');
                log('Refreshed agrippa-pb guidance in CLAUDE.md');
            }
        }
    }
}

export { init };
