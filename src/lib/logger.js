let silent = false;
let jsonMode = false;

function setSilent(value) {
    silent = value;
}

function isSilent() {
    return silent;
}

// --json implies silence: informational log() lines would otherwise
// interleave with the single JSON payload and break stdout as valid JSON.
function setJsonMode(value) {
    jsonMode = value;
    if (value) silent = true;
}

function isJsonMode() {
    return jsonMode;
}

// Emits the single structured result for --json mode. Always goes to stdout,
// never gated by `silent`, so it's the one line of output a --json run produces.
function emitJson(payload) {
    console.log(JSON.stringify(payload, null, 2));
}

// Informational output — suppressed by --quiet/--silent/--json.
function log(...args) {
    if (!silent) console.log(...args);
}

// Warnings and errors are never suppressed: --quiet/--json reduce noise, they
// must never hide something the user needs to see to trust the exit code.
function warn(...args) {
    console.warn(...args);
}

function error(...args) {
    console.error(...args);
}

export { setSilent, isSilent, setJsonMode, isJsonMode, emitJson, log, warn, error };
