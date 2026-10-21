import search from '@inquirer/search';
import { fuzzyMatch } from './fuzzy.js';

const DONE = Symbol('done');
const ALL = Symbol('all');

// Multi-select with fuzzy search: a search prompt re-opened after every pick,
// where picking an item toggles it and "Done" ends the selection. Plain
// checkbox prompts can't be filtered, which is unusable on long lists.
async function fuzzyMultiSelect({ message, items }) {
    const selected = new Set();
    while (true) {
        const choices = [
            { name: `✔ Done (${selected.size} selected)`, value: DONE },
            { name: '★ Select all', value: ALL },
            ...items.map((item) => ({
                name: `${selected.has(item) ? '[x]' : '[ ]'} ${item}`,
                value: item,
                key: item,
            })),
        ];
        const picked = await search({
            message,
            source: async (input) =>
                input ? choices.filter((c) => c.key && fuzzyMatch(c.key, input)) : choices,
        });
        if (picked === DONE) return items.filter((i) => selected.has(i));
        if (picked === ALL) return [...items];
        if (selected.has(picked)) selected.delete(picked);
        else selected.add(picked);
    }
}

export { fuzzyMultiSelect };
