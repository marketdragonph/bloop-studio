// Markdown for the Director's replies (bloop renders them with marked). The text is model output and can quote
// anything on a board, so this escapes EVERYTHING first and then adds a fixed set of tags: headings, bold,
// italics, inline code, fenced code, bullet and numbered lists, paragraphs and line breaks. No raw HTML, no
// links, no attributes: nothing in a reply can run. Streaming-safe: half a ** or an unclosed fence stays text.
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inline(text) {
    return escape(text)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
}

/** Markdown text → safe HTML. */
export function renderMarkdown(text) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null; // { tag: 'ul' | 'ol', items: [] }
    let code = null;

    const flushPara = () => {
        if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
        para = [];
    };
    const flushList = () => {
        if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
        list = null;
    };

    for (const line of lines) {
        if (code) {
            if (/^\s*```/.test(line)) {
                out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
                code = null;
            } else code.push(line);
            continue;
        }
        if (/^\s*```/.test(line)) {
            flushPara();
            flushList();
            code = [];
            continue;
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
        const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
        if (heading) {
            flushPara();
            flushList();
            out.push(`<h${heading[1].length + 2}>${inline(heading[2])}</h${heading[1].length + 2}>`);
        } else if (bullet || numbered) {
            flushPara();
            const tag = bullet ? 'ul' : 'ol';
            if (list?.tag !== tag) flushList();
            list ??= { tag, items: [] };
            list.items.push((bullet ?? numbered)[1]);
        } else if (!line.trim()) {
            flushPara();
            flushList();
        } else {
            flushList();
            para.push(line);
        }
    }
    if (code) para.push('```', ...code); // an unclosed fence while streaming is still plain text
    flushPara();
    flushList();
    return out.join('');
}
