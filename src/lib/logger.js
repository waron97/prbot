let silent = false;

function setSilent(value) {
    silent = value;
}

function log(...args) {
    if (!silent) console.log(...args);
}

export { setSilent, log };
