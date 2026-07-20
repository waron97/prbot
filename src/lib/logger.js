let silent = false;

function setSilent(value) {
    silent = value;
}

function isSilent() {
    return silent;
}

// Informational output — suppressed by --quiet/--silent.
function log(...args) {
    if (!silent) console.log(...args);
}

// Warnings and errors are never suppressed: --quiet reduces noise, it must
// never hide something the user needs to see to trust the exit code.
function warn(...args) {
    console.warn(...args);
}

function error(...args) {
    console.error(...args);
}

export { setSilent, isSilent, log, warn, error };
