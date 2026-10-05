// First run on the page (05-irresistible.md §2.3, §2.6): the one card-source rule, the board's empty bay with its
// three keys (Ask the Director only with a key), the render readout key, the dock's P2b keys and sheet, and the
// house rules for every file P2b touched. No server, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createViews } from '../src/server/views.js';
import { NOTHING_CAN_RENDER, defaultSource, isCloudSource, musicFamily } from '../src/shared/card-source.js';
import { cardSources } from '../src/server/generation/offered.js';
import { controlLabel } from '../src/shared/katana-controls.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const L = [{ id: 'wan5b', label: 'Wan' }];
const C = [{ id: 'bloop:kling', label: 'Kling' }];

test('defaultSource: engine first, then bloop with no engine wall, then a plain sentence', () => {
    assert.deepEqual(defaultSource({ engineReady: true, signedIn: true, local: L, cloud: C }), { kind: 'local', families: [...L, ...C], family: 'wan5b', reason: null });
    assert.deepEqual(defaultSource({ engineReady: false, signedIn: true, local: L, cloud: C }), { kind: 'cloud', families: [...C, ...L], family: 'bloop:kling', reason: null });
    assert.deepEqual(defaultSource({ engineReady: false, signedIn: false, local: L, cloud: C }), { kind: 'none', families: L, family: 'wan5b', reason: NOTHING_CAN_RENDER });
    assert.equal(defaultSource({ engineReady: true, signedIn: false, local: [], cloud: [] }).reason, NOTHING_CAN_RENDER);
    assert.equal(NOTHING_CAN_RENDER, 'Nothing can render yet. Install the engine in Settings, or sign in to bloop to render in the cloud.');
    assert.equal(musicFamily([{ id: 'bloop:tts', label: 'Voice' }, { id: 'bloop:song-2', label: 'Song' }]).id, 'bloop:song-2');
    assert.equal(musicFamily([{ id: 'acestep', label: 'ACE-Step 1.5' }]).id, 'acestep');
    assert.equal(isCloudSource('bloop:x'), true);
    assert.equal(isCloudSource('wan5b'), false);
});

test('cardSources reads the engine, the launcher and the bloop account into that rule', async () => {
    const presets = new Map([['wan5b-t2v', { id: 'wan5b-t2v', card: 'video', label: 'Wan 2.2 5B (t2v)' }]]);
    const engine = (detected) => ({ current: async () => ({ detected, presets }) });
    const account = { signedIn: true, models: async () => ({ video: [{ key: 'kling', name: 'Kling', credits: 40 }] }) };
    const off = { state: () => ({ available: false }) };
    assert.equal((await cardSources({ engine: engine(false), account, launcher: off })('video')).family, 'bloop:kling');
    assert.equal((await cardSources({ engine: engine(true), account, launcher: off })('video')).family, 'wan5b');
    assert.equal((await cardSources({ engine: engine(false), account, launcher: { state: () => ({ available: true }) } })('video')).family, 'wan5b', 'an engine the app can start is ready');
    assert.equal((await cardSources({ engine: engine(false), account: null, launcher: off })('video')).kind, 'none');
});

async function board(directorReady, nodes = []) {
    const views = createViews({ csrfToken: 't' });
    const data = { space: { id: 4, name: 'Empty', canvas_state: { zoom: 1, panX: 0, panY: 0 } }, nodes, connections: [] };
    return views.render('pages/spaces/editor', { board: data, boardJson: JSON.stringify(data), creatableTypes: [], directorReady });
}

test('the empty bay shows the ghost strip and three keys; Ask the Director only with a key', async () => {
    const html = await board(false);
    const bay = html.slice(html.indexOf('class="board__empty"'), html.indexOf('</div>\n  </div>', html.indexOf('class="board__empty"')));
    assert.match(bay, /class="cut-ghost board__ghost"/);
    assert.match(bay, /x-text="emptyText.board"/);
    assert.match(bay, /x-show="directorReady"[^>]*data-control="cut.askDirector"/);
    assert.match(bay, /hx-get="\/spaces\/starters\?space=4" hx-target="#modal"[^>]*data-control="board.starter"/);
    assert.match(bay, /\$dispatch\('cut:bring-pick'\)" data-control="board.bringClips"/);
    for (const id of ['board.starter', 'board.bringClips', 'cut.askDirector']) assert.ok(bay.includes(`<span>${controlLabel(id)}</span>`), id);
    assert.match(html, /data-director-ready="0"/);
    assert.match(await board(true), /data-director-ready="1"/);
    // The board's render readout key opens the dock's sheet; files dropped on the empty board are Bring my clips.
    assert.match(html, /@click="\$dispatch\('cut:render-open'\)"\s+data-control="cut.renderMissing"/);
    assert.match(html, /@drop.prevent="bringDrop\(\$event\)"/);
});

test('the dock carries the P2b keys and the Render missing beats sheet, all registry controls', async () => {
    const html = await board(false);
    const dock = html.slice(html.indexOf('<section class="cut-dock"'));
    for (const id of ['cut.renderMissing', 'cut.addNew', 'cut.renderCancelAll', 'cut.renderConfirm', 'cut.renderNotNow', 'cut.openSettings', 'cut.signIn', 'board.bringClips']) {
        assert.ok(dock.includes(`data-control="${id}"`), id);
    }
    assert.match(dock, /@cut:render-open.window="cutRenderOpen\(\)" @cut:bring-pick.window="cutBringPick\(\)" @cut:bring.window="cutBring\(\$event.detail.files\)"/);
    assert.match(dock, /data-cut-part="bring-input" multiple/);
    assert.match(dock, /class="ae-key ae-key--sm ae-key--accent" x-show="cutRender\?\.cards" @click="cutRenderGo\(\)"/, 'the one orange key: the person\'s press');
    assert.match(dock, /href="\/settings#bloop-account" data-control="cut.signIn"/);
    // The empty Spaces list offers the starters too.
    const index = await createViews({ csrfToken: 't' }).render('pages/spaces/index', { spaces: [] });
    assert.match(index, /hx-get="\/spaces\/starters" hx-target="#modal"[^>]*data-control="board.starter"/);
});

test('every file P2b touched keeps the house rules: ≤ 500 lines, tokens only, no inline styles', () => {
    const files = [
        'src/server/cut/live-cut.js', 'src/server/cut/cut-draft.js', 'src/server/cut/cut-edits.js', 'src/server/generation/render-plan/index.js',
        'src/server/generation/render-plan/owed.js', 'src/server/generation/render-plan/estimate.js', 'src/server/generation/enqueue.js',
        'src/server/generation/offered.js', 'src/server/generation/media-store.js', 'src/server/routes/uploads.js', 'src/server/routes/render-plan.js',
        'src/server/routes/starters.js', 'src/server/routes/generation.js', 'src/server/routes/spaces.js', 'src/server/spaces/apply-starter.js',
        'src/server/server.js', 'src/shared/card-source.js', 'src/shared/cut-rebase.js', 'src/shared/katana-controls.js',
        'public/js/components/cut-dock.js', 'public/js/components/cut-auto.js', 'public/js/components/cut-render.js', 'public/js/components/cut-bring.js',
        'public/js/components/cut-persistence.js', 'public/js/board/board.js', 'public/js/board/uploads.js', 'public/css/cut-first-run.css',
        'src/server/views/pages/spaces/editor.edge', 'src/server/views/pages/spaces/starter-modal.edge', 'src/server/views/pages/spaces/cut/render-sheet.edge',
        'src/server/views/pages/spaces/cut/rail.edge', 'src/server/views/pages/spaces/cut/states.edge', 'src/server/views/pages/spaces/cut/dock.edge',
    ];
    for (const file of files) {
        const text = read(file);
        assert.ok(text.split('\n').length <= 500, `${file}: ${text.split('\n').length} lines`);
        if (file.endsWith('.edge')) assert.doesNotMatch(text, /\sstyle="/, `${file}: no inline styles`);
    }
    const css = read('public/css/cut-first-run.css');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(css, /rgba?\(|hsla?\(/);
    assert.doesNotMatch(css, /!important/);
    assert.match(read('public/css/app.css'), /@import url\('\.\/cut-first-run\.css'\);/);
});
