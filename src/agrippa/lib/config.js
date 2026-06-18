import { existsSync, readFileSync, writeFileSync } from 'fs';
import { parse, stringify } from 'yaml';
import { configDotenv } from 'dotenv';
import { CONFIG_FILE } from '../../config.js';

const WORKSPACE_FILE = 'agrippa.yaml';

function readConfig() {
    if (!existsSync(WORKSPACE_FILE)) {
        throw new Error('agrippa.yaml not found in current directory. Run `agrippa init` first.');
    }
    return parse(readFileSync(WORKSPACE_FILE, 'utf-8'));
}

function writeConfig(config) {
    writeFileSync(WORKSPACE_FILE, stringify(config, { lineWidth: 0 }), 'utf-8');
}

function loadEffectiveEnv(localConfig) {
    // Load global prbot config as the base (KC_URL, KC_USER, RIP_URL, etc. live here)
    if (existsSync(CONFIG_FILE)) {
        configDotenv({ path: CONFIG_FILE, quiet: true });
    }

    // Overlay workspace-level overrides from agrippa.yaml's agrippa: section
    const overrides = localConfig?.agrippa ?? {};
    const keys = ['KC_URL', 'KC_USER', 'KC_PASSWORD', 'KC_ID', 'KC_SECRET', 'RIP_URL', 'PB_URL'];
    for (const key of keys) {
        if (overrides[key]) {
            process.env[key] = overrides[key];
        }
    }
}

export { readConfig, writeConfig, loadEffectiveEnv, WORKSPACE_FILE };
