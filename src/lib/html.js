// Small, dependency-free HTML→markdown converter. Not a general-purpose HTML
// parser — it's sized to the markup Odoo actually produces for `project.task`
// description fields (paragraphs, line breaks, bold/italic, links, lists,
// inline images), which is enough to render usefully in a .md file. Anything
// outside that (tables, nested lists, styled spans, ...) is stripped down to
// its plain text rather than mis-rendered.

function decodeEntities(str) {
    return str
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/gi, "'");
}

function htmlToMarkdown(html) {
    if (!html) return '';

    let out = '';
    let lastIndex = 0;
    let match;
    const listStack = []; // { type: 'ul' | 'ol', index: number }
    const linkStack = []; // pending href for the currently-open <a>

    // Raw text between tags: collapse the source's own whitespace/indentation
    // into single spaces. Paragraph/line breaks are produced by the tag
    // handling below, not by whitespace in the source.
    function appendText(text) {
        const cleaned = text.replace(/\s+/g, ' ');
        if (cleaned.trim() === '') return;
        out += cleaned;
    }

    const tagRe = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g;
    while ((match = tagRe.exec(html)) !== null) {
        const [, closing, rawTag, attrs] = match;
        const tag = rawTag.toLowerCase();
        appendText(html.slice(lastIndex, match.index));
        lastIndex = tagRe.lastIndex;
        const isClosing = closing === '/';

        switch (tag) {
            case 'br':
                out += '\n';
                break;
            case 'p':
            case 'div':
                // Odoo commonly wraps list-item text in a <p> (<li><p>...</p></li>);
                // inside a list, let <li> alone own the line breaks.
                if (listStack.length === 0) out += '\n\n';
                break;
            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6':
                out += isClosing ? '\n\n' : `\n\n${'#'.repeat(Number(tag[1]))} `;
                break;
            case 'strong':
            case 'b':
                out += '**';
                break;
            case 'em':
            case 'i':
                out += '_';
                break;
            case 'a':
                if (!isClosing) {
                    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
                    linkStack.push(hrefMatch ? hrefMatch[1] : '');
                    out += '[';
                } else {
                    const href = linkStack.pop() ?? '';
                    out += `](${href})`;
                }
                break;
            case 'img': {
                const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
                out += `![](${srcMatch ? srcMatch[1] : ''})`;
                break;
            }
            case 'ul':
            case 'ol':
                if (!isClosing) listStack.push({ type: tag, index: 0 });
                else listStack.pop();
                out += '\n';
                break;
            case 'li':
                if (!isClosing) {
                    const ctx = listStack[listStack.length - 1];
                    if (ctx && ctx.type === 'ol') {
                        ctx.index += 1;
                        out += `\n${ctx.index}. `;
                    } else {
                        out += '\n- ';
                    }
                }
                break;
            default:
                // Unknown/unsupported tag (span, table, etc.): drop the tag,
                // keep its text content via the surrounding appendText calls.
                break;
        }
    }
    appendText(html.slice(lastIndex));

    return decodeEntities(out)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export { htmlToMarkdown };
