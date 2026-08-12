import { existsSync, readFileSync, writeFileSync } from 'fs';
import { configDotenv } from 'dotenv';
import { parse, stringify } from 'yaml';
import { CONFIG_FILE } from '../../config.js';
import { warn } from '../../lib/logger.js';

const WORKSPACE_FILE = 'agrippa.yaml';

// Keys that used to be readable from agrippa.yaml's `agrippa:` block. Kept only
// so loadEffectiveEnv can warn about stale overrides left over from before
// --secrets-file existed.
const LEGACY_OVERRIDE_KEYS = ['KC_URL', 'KC_USER', 'KC_PASSWORD', 'KC_ID', 'KC_SECRET', 'RIP_URL', 'PB_URL'];

function readConfig() {
    if (!existsSync(WORKSPACE_FILE)) {
        throw new Error('agrippa.yaml not found in current directory. Run `agrippa init` first.');
    }
    return parse(readFileSync(WORKSPACE_FILE, 'utf-8'));
}

function writeConfig(config) {
    writeFileSync(WORKSPACE_FILE, stringify(config, { lineWidth: 0 }), 'utf-8');
}

function warnLegacyOverrides(localConfig) {
    const overrides = localConfig?.agrippa ?? {};
    const stale = LEGACY_OVERRIDE_KEYS.filter((key) => overrides[key]);
    if (stale.length) {
        warn(
            `agrippa.yaml has legacy credential override(s) under \`agrippa:\` (${stale.join(', ')}) ` +
                'that are no longer read. Move these values to --secrets-file or the global prbot ' +
                'config (~/.config/prbot/config), then remove the `agrippa:` block.'
        );
    }
}

function assertKeycloakConfigured() {
    const required = ['KC_URL', 'KC_USER', 'KC_PASSWORD', 'KC_ID', 'KC_SECRET'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
        throw new Error(
            `Missing Keycloak credential(s): ${missing.join(', ')}. ` +
                'Set them via --secrets-file <path> or the global prbot config (`prbot init`).'
        );
    }
}

// Resolution order (highest priority first), per key:
//   1. --secrets-file <path>, if given — must exist, or this throws.
//   2. The global prbot config (~/.config/prbot/config).
// configDotenv() never overwrites a process.env key that's already set, so
// loading secretsFile first and CONFIG_FILE second gives per-key priority to
// whichever source set that key first.
function loadEffectiveEnv(localConfig, secretsFile) {
    if (secretsFile) {
        if (!existsSync(secretsFile)) {
            throw new Error(`--secrets-file not found: ${secretsFile}`);
        }
        configDotenv({ path: secretsFile, quiet: true });
    }

    if (existsSync(CONFIG_FILE)) {
        configDotenv({ path: CONFIG_FILE, quiet: true });
    }

    warnLegacyOverrides(localConfig);
    assertKeycloakConfigured();
}

export { readConfig, writeConfig, loadEffectiveEnv, WORKSPACE_FILE };
