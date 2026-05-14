function fuzzyMatch(str, query) {
    const s = str.toLowerCase();
    const q = query.toLowerCase();
    let si = 0;
    for (const ch of q) {
        si = s.indexOf(ch, si);
        if (si === -1) return false;
        si++;
    }
    return true;
}

export { fuzzyMatch };
