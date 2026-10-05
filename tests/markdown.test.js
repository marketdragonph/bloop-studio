import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/js/board/markdown.js';

test('the Director reply renders its markdown: paragraphs, bold, lists, headings, code', () => {
    const html = renderMarkdown('**Uno and the lighthouse**\n\nThree beats:\n1. Uno finds the *key*\n2. The door\n\n- cast: `uno`\n- 9:16\n\n## Next');
    assert.equal(html, '<p><strong>Uno and the lighthouse</strong></p><p>Three beats:</p><ol><li>Uno finds the <em>key</em></li><li>The door</li></ol><ul><li>cast: <code>uno</code></li><li>9:16</li></ul><h4>Next</h4>');
});

test('nothing in a reply can become markup: HTML is escaped, links stay text', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> [click](javascript:alert(1)) **<b>x</b>**');
    assert.ok(!/<img|<b>|href/.test(html));
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(renderMarkdown('```\n<script>x</script>\n```'), '<pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>');
});

test('half-written markdown while streaming stays plain text', () => {
    assert.equal(renderMarkdown('This is **half'), '<p>This is **half</p>');
    assert.equal(renderMarkdown('```js\nconst a'), '<p>```<br>const a</p>');
});
