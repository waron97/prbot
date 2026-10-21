import { existsSync, readFileSync } from 'fs';
import { configDotenv, parse } from 'dotenv';
import { CONFIG_FILE } from '../config.js';

// Keys that identify *which environment* a command talks to. With a secrets
// file targeting e.g. test-01, letting any of these fall back to the global
// config (always test-02) would silently send part of an operation to the
// wrong environment — a test-01 token against a test-02 PB_URL, say.
const ENV_SPECIFIC_KEYS = [
    'KC_URL',
    'KC_USER',
    'KC_PASSWORD',
    'KC_ID',
    'KC_SECRET',
    'RIP_URL',
    'IMPORTEXPORT_URL',
    'PB_URL',
];

// Resolution order (highest priority first), per key:
//   1. The process environment.
//   2. secretsFile, if given — must exist, or this throws.
//   3. The global prbot config (~/.config/prbot/config). With isolateEnvKeys
//      and a secretsFile, ENV_SPECIFIC_KEYS are never taken from here: a key
//      the secrets file doesn't set stays unset, and the command fails on it.
// configDotenv() never overwrites a key already in process.env, so loading the
// secrets file first gives it priority over the global config.
function loadConfigFiles(secretsFile, { isolateEnvKeys = false } = {}) {
    if (secretsFile) {
        if (!existsSync(secretsFile)) {
            throw new Error(`--secrets-file not found: ${secretsFile}`);
        }
        configDotenv({ path: secretsFile, quiet: true });
    }

    if (!existsSync(CONFIG_FILE)) return;
    if (!secretsFile || !isolateEnvKeys) {
        configDotenv({ path: CONFIG_FILE, quiet: true });
        return;
    }
    const globalConfig = parse(readFileSync(CONFIG_FILE));
    for (const [key, value] of Object.entries(globalConfig)) {
        if (ENV_SPECIFIC_KEYS.includes(key)) continue;
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

// Commander parses options only after this module has loaded, but the config
// must be in process.env before any command runs, so read the flag directly.
// Accepts `--secrets-file <path>` and `--secrets-file=<path>`, anywhere in argv.
function secretsFileFromArgv(argv) {
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--secrets-file') return argv[i + 1];
        if (argv[i].startsWith('--secrets-file=')) return argv[i].slice('--secrets-file='.length);
    }
    return undefined;
}

export { ENV_SPECIFIC_KEYS, loadConfigFiles, secretsFileFromArgv };
