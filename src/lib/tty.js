function requireInteractive(hint) {
    if (!process.stdin.isTTY) {
        throw new Error(`Interactive selection requires a TTY; ${hint}`);
    }
}

export { requireInteractive };
