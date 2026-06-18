import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG_DIR } from '../config.js';

const CACHE_FILE = path.join(CONFIG_DIR, '.update-check');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

export const currentVersion = pkg.version;

function semverGt(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return true;
        if (pa[i] < pb[i]) return false;
    }
    return false;
}

function readCache() {
    try {
        if (!existsSync(CACHE_FILE)) return null;
        const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
        if (Date.now() - new Date(data.checkedAt).getTime() > CACHE_TTL_MS) return null;
        return data.latestVersion;
    } catch {
        return null;
    }
}

function writeCache(latestVersion) {
    try {
        mkdirSync(CONFIG_DIR, { recursive: true });
        writeFileSync(
            CACHE_FILE,
            JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion })
        );
    } catch {
        // non-critical
    }
}

function fetchLatest() {
    return new Promise((resolve) => {
        execFile('npm', ['view', '@waron97/prbot', 'version'], { timeout: 5000 }, (err, stdout) => {
            if (err) resolve(null);
            else resolve(stdout.trim());
        });
    });
}

export async function checkForUpdate() {
    const cached = readCache();
    const latest = cached ?? (await fetchLatest());
    if (latest && !cached) writeCache(latest);
    if (latest && semverGt(latest, currentVersion)) return latest;
    return null;
}
