import { existsSync, writeFileSync } from 'fs';
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
            console.log('Aborted.');
            return;
        }
    }

    writeFileSync(WORKSPACE_FILE, TEMPLATE, 'utf-8');
    console.log(`Created ${WORKSPACE_FILE}`);
    console.log(`Run 'agrippa clone' to add resources to this workspace.`);
    console.log(`Add ${WORKSPACE_FILE} to .gitignore if it contains credentials.`);
}

export { init };
