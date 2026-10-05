// Export presets and the Shapes row (05-irresistible.md §5.1, §5.4): one list for the sheet, the route, the
// export and the Director's outputs op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_PRESETS, LIMITS_CHECKED_ON, checkPreset, lengthHint, outputLabel, outputName, outputsFor, presetLine, presetOutput } from '../src/shared/export-presets.js';
import { checkOutputs, checkSettings } from '../src/shared/cut-rules.js';

test('TikTok, Reels and Shorts: 9:16, 1080 × 1920, 30 fps, −14 LUFS, whatever the cut’s resolution', () => {
    for (const id of ['tiktok', 'reels', 'shorts']) {
        const out = presetOutput(id, { resolution: 720, aspect: '16:9' });
        assert.deepEqual([out.width, out.height, out.aspect, out.fps, out.lufs], [1080, 1920, '9:16', 30, -14]);
        assert.equal(EXPORT_PRESETS[id].phase, 'P6');
    }
    assert.equal(presetLine(presetOutput('tiktok', {}), 30_000), '1080 × 1920 · 30 fps · about 31 MB · −14 LUFS');
    assert.equal(checkPreset('reels'), null);
    assert.match(checkPreset('vine'), /Master, YouTube, TikTok, Reels or Shorts/);
    // P3 unchanged: Master keeps the cut's shape and resolution, YouTube is 1080p 16:9.
    assert.deepEqual(['width', 'height', 'lufs'].map((k) => presetOutput('master', { resolution: 720, aspect: '9:16' })[k]), [720, 1280, -16]);
    assert.deepEqual(['width', 'height'].map((k) => presetOutput('youtube', { resolution: 720 })[k]), [1920, 1080]);
    assert.deepEqual(['width', 'height', 'aspect'].map((k) => presetOutput('master', { resolution: 1080, aspect: '16:9' }, '1:1')[k]), [1080, 1080, '1:1']);
});

test('the Shapes row: one file per shape, the preset’s own first, any other shape a Master of that shape', () => {
    assert.deepEqual(outputsFor('tiktok', ['16:9', '9:16'], '16:9'), [{ preset: 'tiktok', variant: '9:16' }, { preset: 'master', variant: '16:9' }]);
    assert.deepEqual(outputsFor('master', ['16:9', '9:16', '1:1'], '16:9'), [{ preset: 'master', variant: '16:9' }, { preset: 'master', variant: '9:16' }, { preset: 'master', variant: '1:1' }]);
    assert.deepEqual(outputsFor('youtube', null, '9:16'), [{ preset: 'youtube', variant: '16:9' }]);
    assert.deepEqual(outputsFor('master', [], '9:16'), [{ preset: 'master', variant: '9:16' }]);
    assert.equal(outputName('master', '9:16', '16:9'), 'master-9x16');
    assert.equal(outputName('master', '16:9', '16:9'), 'master');
    assert.equal(outputName('tiktok', '9:16', '16:9'), 'tiktok');
    assert.equal(outputLabel('master', '1:1', '16:9'), 'Master 1:1');
    assert.equal(outputLabel('reels', '9:16', '16:9'), 'Reels');
});

test('length limits are hints with the date they were checked, never refusals', () => {
    assert.equal(lengthHint('tiktok', 120_000), null);
    assert.equal(lengthHint('reels', 200_000), `Reels takes up to 3:00; this cut is 3:20. It still exports (limit checked ${LIMITS_CHECKED_ON}).`);
    assert.equal(lengthHint('shorts', 181_000), `Shorts takes up to 3:00; this cut is 3:01. It still exports (limit checked ${LIMITS_CHECKED_ON}).`);
    assert.equal(lengthHint('master', 600_000), null);
});

test('settings.outputs: preset, 1–3 distinct shapes, captions off or burned, booleans, fixes; never a crop box', () => {
    const base = { resolution: 1080, fps: 30 };
    assert.equal(checkSettings({ ...base, outputs: { preset: 'tiktok', shapes: ['9:16', '16:9'], captions: 'burned', soft_bars: true, gif: false, caption_text: { 's1': 'Hi.' } } }), null);
    assert.match(checkOutputs({ preset: 'vine' }), /Pick Master/);
    assert.match(checkOutputs({ shapes: [] }), /one to three shapes/);
    assert.match(checkOutputs({ shapes: ['9:16', '9:16'] }), /each once/);
    assert.match(checkOutputs({ shapes: ['4:3'] }), /each once/);
    assert.match(checkOutputs({ captions: 'auto' }), /off or burned in/);
    assert.match(checkOutputs({ gif: 'yes' }), /preview GIF is on or off/);
    assert.match(checkOutputs({ frame: {} }), /no frame choice/);
    assert.match(checkSettings({ ...base, outputs: { caption_text: { s1: 'x'.repeat(400) } } }), /at most 300/);
});
