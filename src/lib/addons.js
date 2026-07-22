function resolveAddonsPath(addonsPath = process.env.ADDONS_PATH) {
    const value = (addonsPath ?? '').trim();
    // Unset, empty, or the explicit "." sentinel => operate on the repo in
    // the current working directory (e.g. a git worktree), instead of a
    // fixed global checkout.
    if (value === '' || value === '.') {
        return process.cwd();
    }
    if (value.startsWith('~')) {
        return value.replace('~', process.env.HOME);
    }
    return value;
}

export { resolveAddonsPath };
