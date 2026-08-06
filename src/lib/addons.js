import { existsSync } from 'fs';
import { join } from 'path';
import { log } from './logger.js';

// Paths already announced this process, so a command that resolves the same
// root more than once (e.g. exportWorkflow.js calls this twice) only prints
// the destination once.
const announced = new Set();

function resolveAddonsPath(addonsPath = process.env.ADDONS_PATH) {
    const raw = (addonsPath ?? '').trim();
    // Unset, empty, or the explicit "." sentinel => operate on the repo in
    // the current working directory (e.g. a git worktree), instead of a
    // fixed global checkout.
    const usedCwdFallback = raw === '' || raw === '.';
    let value = usedCwdFallback ? process.cwd() : raw;
    if (!usedCwdFallback && (value === '~' || value.startsWith('~/'))) {
        value = process.env.HOME + value.slice(1);
    }

    // Every command that resolves this path ends up writing into it (export,
    // pre-migrate, changelog, git add/commit) or reading files that only
    // exist in a real addons checkout. With no validation, an unset or wrong
    // ADDONS_PATH silently falls back to whatever directory the command
    // happened to be run from, and `fs.mkdir(..., { recursive: true })`
    // downstream makes that directory look like a valid destination instead
    // of failing loudly.
    const hasGit = existsSync(join(value, '.git'));
    const hasConfig = existsSync(join(value, 'config'));
    if (!hasGit || !hasConfig) {
        const missing = [!hasGit && '.git', !hasConfig && 'config/'].filter(Boolean).join(' and ');
        const source = usedCwdFallback
            ? 'ADDONS_PATH is not set — falling back to the current directory'
            : `ADDONS_PATH is set to "${raw}"`;
        throw new Error(
            `resolved addons path "${value}" is missing ${missing} — it doesn't look like an ` +
                `addons checkout (${source}). Run \`prbot init\` to set ADDONS_PATH, or run this ` +
                `command from inside the checkout.`
        );
    }

    if (!announced.has(value)) {
        announced.add(value);
        log(`Addons path: ${value}`);
    }

    return value;
}

export { resolveAddonsPath };
