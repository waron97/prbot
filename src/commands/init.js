import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { COMPLETION_SCRIPT, CONFIG_DIR, CONFIG_FILE } from '../config.js';

async function init(completion) {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }

    const existing = existsSync(CONFIG_FILE)
        ? Object.fromEntries(
              readFileSync(CONFIG_FILE, 'utf-8')
                  .split('\n')
                  .flatMap((line) => {
                      const m = line.match(/^([A-Z_]+)=(.*)$/);
                      return m ? [[m[1], m[2]]] : [];
                  })
          )
        : {};

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'ADDONS_PATH',
            message: 'Addons path:',
            default: existing.ADDONS_PATH ?? '~/codebase/sorgenia/addons',
        },
        {
            type: 'input',
            name: 'KC_URL',
            message: 'Keycloak URL:',
            default: existing.KC_URL ?? '',
        },
        {
            type: 'input',
            name: 'KC_USER',
            message: 'Keycloak user:',
            default: existing.KC_USER ?? '',
        },
        {
            type: 'password',
            name: 'KC_PASSWORD',
            message: `Keycloak password${existing.KC_PASSWORD ? ' (leave blank to keep existing)' : ''}:`,
            mask: '*',
        },
        {
            type: 'input',
            name: 'KC_ID',
            message: 'Keycloak client ID:',
            default: existing.KC_ID ?? '',
        },
        {
            type: 'input',
            name: 'KC_SECRET',
            message: 'Keycloak client secret:',
            default: existing.KC_SECRET ?? '',
        },
        {
            type: 'input',
            name: 'RIP_URL',
            message: 'RIP URL:',
            default: existing.RIP_URL ?? '',
        },
        {
            type: 'input',
            name: 'TRIDENT_URL',
            message: 'Trident URL:',
            default: existing.TRIDENT_URL ?? '',
        },
        {
            type: 'input',
            name: 'TRIDENT_UID',
            message: 'Trident UID:',
            default: existing.TRIDENT_UID ?? '',
        },
        {
            type: 'input',
            name: 'TRIDENT_TOKEN',
            message: 'Trident token:',
            default: existing.TRIDENT_TOKEN ?? '',
        },
        {
            type: 'input',
            name: 'DEVOPS_TOKEN',
            message: 'DevOps token:',
            default: existing.DEVOPS_TOKEN ?? '',
        },
        {
            type: 'input',
            name: 'DEVOPS_ORG',
            message: 'DevOps org:',
            default: existing.DEVOPS_ORG ?? '',
        },
        {
            type: 'input',
            name: 'DEVOPS_PROJECT',
            message: 'DevOps project:',
            default: existing.DEVOPS_PROJECT ?? '',
        },
        {
            type: 'input',
            name: 'DEVOPS_REPO',
            message: 'DevOps repo:',
            default: existing.DEVOPS_REPO ?? '',
        },
        {
            type: 'input',
            name: 'TRIDENT_DB',
            message: 'Trident DB name:',
            default: existing.TRIDENT_DB ?? 'trident-agora',
        },
        {
            type: 'input',
            name: 'AUTOPR_TARGET_BRANCH',
            message: 'AutoPR target branch:',
            default: existing.AUTOPR_TARGET_BRANCH ?? '15.0-dev',
        },
        {
            type: 'input',
            name: 'IMPORTEXPORT_URL',
            message: 'ImportExport URL:',
            default:
                existing.IMPORTEXPORT_URL ??
                'https://sorgenia-test-02.symple.cloud/api/importexport/v1/',
        },
    ]);

    if (!answers.KC_PASSWORD && existing.KC_PASSWORD) {
        answers.KC_PASSWORD = existing.KC_PASSWORD;
    }

    writeFileSync(
        CONFIG_FILE,
        Object.entries(answers)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n') + '\n'
    );
    console.log(`Config written to ${CONFIG_FILE}`);

    writeFileSync(COMPLETION_SCRIPT, completion.generateCompletionCode());
    console.log(`Completion script written to ${COMPLETION_SCRIPT}`);

    const rcFile = path.join(process.env.HOME || '', '.bashrc');
    const sourceLine = `source ${COMPLETION_SCRIPT}`;
    const rcContent = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : '';
    if (!rcContent.includes(sourceLine)) {
        appendFileSync(rcFile, `\n# prbot completion\n${sourceLine}\n`);
        console.log(`Registered completion in ${rcFile} — run: source ~/.bashrc`);
    } else {
        console.log('Completion already registered in ~/.bashrc');
    }
}

export { init };
