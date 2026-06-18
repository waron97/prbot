import { readConfig, writeConfig } from '../lib/config.js';
import { fileExists } from '../lib/workspace.js';

async function repair() {
    const config = readConfig();
    const before = config.workspace.length;

    const stale = config.workspace.filter((entry) => !fileExists(entry.path));
    config.workspace = config.workspace.filter((entry) => fileExists(entry.path));

    if (!stale.length) {
        console.log('No stale entries found.');
        return;
    }

    for (const entry of stale) {
        console.log(`  removed: ${entry.path} (${entry.name})`);
    }

    writeConfig(config);
    console.log(
        `Removed ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'} (${before} → ${config.workspace.length}).`
    );
}

export { repair };
