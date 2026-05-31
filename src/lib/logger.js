let silent = false;

function setSilent(value) {
    silent = value;
}

function isSilent() {
    return silent;
}

function log(...args) {
    if (!silent) console.log(...args);
}

export { setSilent, isSilent, log };
