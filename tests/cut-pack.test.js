// Pack assets (01-core.md §8, 05 §5.7): a store-only ZIP job on the media-tools queue. No ffmpeg, no GPU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { toolsFixture } from './cut-tools-fixture.js';

const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

/** Entries of a ZIP from its central directory (ZIP64 aware), and a reader for stored entries. */
function readZip(file) {
    const buf = readFileSync(file);
    let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let count = buf.readUInt16LE(eocd + 10);
    let at = buf.readUInt32LE(eocd + 16);
    if (at === 0xffffffff) {
        const z = buf.readUInt32LE(buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07])) + 8);
        count = Number(buf.readBigUInt64LE(z + 32));
        at = Number(buf.readBigUInt64LE(z + 48));
    }
    const entries = [];
    for (let i = 0; i < count; i++) {
        assert.equal(buf.readUInt32LE(at), 0x02014b50);
        const nameLen = buf.readUInt16LE(at + 28);
        const extraLen = buf.readUInt16LE(at + 30);
        const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
        let size = buf.readUInt32LE(at + 24);
        let offset = buf.readUInt32LE(at + 42);
        const extra = buf.subarray(at + 46 + nameLen, at + 46 + nameLen + extraLen);
        if (extra.length && extra.readUInt16LE(0) === 1) {
            let k = 4;
            if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(k)); k += 16; }
            if (offset === 0xffffffff) offset = Number(extra.readBigUInt64LE(k));
        }
        entries.push({ name, size, offset, crc: buf.readUInt32LE(at + 16) });
        at += 46 + nameLen + extraLen + buf.readUInt16LE(at + 32);
    }
    eocd = null;
    const data = (name) => {
        const e = entries.find((x) => x.name === name);
        const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
        return buf.subarray(start, start + e.size);
    };
    return { entries, names: entries.map((e) => e.name), data };
}

let fx;
before(async () => { fx = await toolsFixture('bloop-pack-'); });
after(() => fx.close());

async function packedBoard(name) {
    const b = await fx.board(name, ['s1-open', 's2-turn'], { joins: [null, { type: 'dissolve', ms: 500 }] });
    await fx.clip(b.space.id, 'look', 1, { type: 'image', mime: 'image/png', params: { prompt: 'a neon street', model: 'flux' } });
    const words = fx.spaces.createNode(b.space.id, { type: 'text', label: 's1-open', text_content: 'She opens the door.' });
    const { export: job } = await (await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, { preset: 'master' })).json();
    assert.equal((await fx.settle(job.id)).status, 'done');
    return { ...b, words };
}

test('Pack: layout, manifest v1 with prompts, seeds and models, no keys; readable by Windows tar', async () => {
    const { space, clips, bed } = await packedBoard('Night Market');
    const res = await fx.send('POST', `/spaces/${space.id}/cut/pack`, {});
    assert.equal(res.status, 202);
    const { export: job } = await res.json();
    assert.equal(job.kind, 'pack');
    const row = await fx.settle(job.id);
    assert.equal(row.status, 'done', row.error);
    assert.match(row.media_path, new RegExp(`^spaces/${space.id}/packs/Night Market-\\d{8}-\\d{4}\\.zip$`));
    const zipFile = join(fx.mediaRoot, row.media_path);
    const zip = readZip(zipFile);
    const [a, b] = clips;
    assert.ok(zip.names.includes(`beats/01-s1-open/s1-open-take${a.take.id}-seed7.mp4`), zip.names.join('\n'));
    assert.ok(zip.names.includes(`beats/02-s2-turn/s2-turn-take${b.take.id}-seed7.mp4`));
    assert.ok(zip.names.includes(`sound/music bed-take${bed.take.id}-seed7.mp3`));
    assert.ok(zip.names.some((n) => /^stills\/look-take\d+-seed7\.png$/.test(n)));
    assert.ok(zip.names.includes('cut/night-market-master-r1.mp4'));
    assert.ok(zip.names.includes('cut/night-market-master-r1-poster.jpg'));
    assert.ok(zip.names.some((n) => n.startsWith('notes/01-s1-open-') && n.endsWith('.md')));
    assert.ok(zip.names.includes('manifest.json'));
    assert.equal(row.report.files, zip.names.length);
    // The copied bytes are the file's bytes.
    assert.equal(zip.data(`beats/01-s1-open/s1-open-take${a.take.id}-seed7.mp4`).toString(), readFileSync(join(fx.mediaRoot, a.path), 'utf8'));

    const manifest = JSON.parse(zip.data('manifest.json').toString('utf8'));
    assert.equal(manifest.format, 'bloop-studio-pack');
    assert.equal(manifest.version, 1);
    assert.equal(manifest.app.version, '9.9.9');
    assert.equal(manifest.space.name, 'Night Market');
    assert.deepEqual(manifest.plan.beats.map((x) => x.tag), ['s1-open', 's2-turn']);
    const t = manifest.takes.find((x) => x.card === 's1-open');
    assert.equal(t.prompt, 'a shot of s1-open');
    assert.equal(t.seed, 7);
    assert.equal(t.model, 'wan');
    assert.equal(t.duration_ms, 4000);
    assert.equal(t.in_cut, true);
    assert.equal(t.out_ms, 4000);
    assert.equal(manifest.board.cut.revision, 1);
    assert.equal(manifest.board.cut.items.length, 2);
    assert.ok(manifest.board.cards.length >= 5 && manifest.board.wires);
    assert.equal(manifest.export.file, 'cut/night-market-master-r1.mp4');
    const text = JSON.stringify(manifest);
    assert.ok(!text.includes('sk-secret') && !/api_key/.test(text), 'no keys in the manifest');

    if (existsSync(TAR)) {
        const listed = execFileSync(TAR, ['-tf', zipFile], { encoding: 'utf8' }).trim().split(/\r?\n/);
        assert.deepEqual(listed.sort(), [...zip.names].sort());
    }
    assert.equal(existsSync(join(fx.mediaRoot, '.cut-tmp', `pack-${job.id}`)), false);
});

test('Pack without prompts and seeds (a client job); a missing file is listed, not fatal', async () => {
    const { space, clips } = await packedBoard('Client job');
    await rm(join(fx.mediaRoot, clips[1].path));
    const { export: job } = await (await fx.send('POST', `/spaces/${space.id}/cut/packs`, { include_prompts: false })).json();
    const row = await fx.settle(job.id);
    assert.equal(row.status, 'done', row.error);
    const zip = readZip(join(fx.mediaRoot, row.media_path));
    assert.ok(zip.names.includes(`beats/01-s1-open/s1-open-take${clips[0].take.id}.mp4`), 'no seed in the name');
    assert.ok(!zip.names.some((n) => n.startsWith('notes/')));
    const manifest = JSON.parse(zip.data('manifest.json').toString('utf8'));
    assert.equal(manifest.options.include_prompts, false);
    const text = JSON.stringify(manifest);
    assert.ok(!/"prompt"|"seed"|a shot of/.test(text), 'no prompts or seeds');
    assert.deepEqual(manifest.missing.map((m) => m.path), [clips[1].path]);
    assert.deepEqual(row.report.missing, [clips[1].path]);
});

test('one pack per space at a time; cancel while it waits; not enough disk refuses', async () => {
    const { space } = await fx.board('Busy', ['a'], { music: false });
    // Hold the one slot with a hanging export, so the pack waits.
    fx.env.mode = 'hang';
    const hold = await (await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'master' })).json();
    try {
        const first = await fx.send('POST', `/spaces/${space.id}/cut/pack`, {});
        assert.equal(first.status, 202);
        const { export: pack } = await first.json();
        const again = await fx.send('POST', `/spaces/${space.id}/cut/pack`, {});
        assert.equal(again.status, 200);
        assert.equal((await again.json()).export.id, pack.id);
        const cancel = await fx.send('DELETE', `/spaces/${space.id}/cut/exports/${pack.id}`);
        assert.equal((await cancel.json()).export.status, 'cancelled');
    } finally {
        await fx.send('DELETE', `/spaces/${space.id}/cut/exports/${hold.export.id}`);
        fx.env.mode = 'ok';
        await fx.settle(hold.export.id);
    }
    fx.env.freeBytes = 10;
    try {
        const { export: job } = await (await fx.send('POST', `/spaces/${space.id}/cut/pack`, {})).json();
        const row = await fx.settle(job.id);
        assert.equal(row.status, 'failed');
        assert.equal(row.error_code, 'disk');
        assert.match(row.error, /The pack needs about .* GB free/);
    } finally {
        delete fx.env.freeBytes;
    }
});

test('ZIP64 records and Windows-unsafe names still open in Windows tar', async () => {
    const z = await toolsFixture('bloop-pack64-', { zip64: 'always' });
    try {
        const { space } = await z.board('CON: a/b?', ['aux'], { music: false });
        const { export: job } = await (await z.send('POST', `/spaces/${space.id}/cut/pack`, {})).json();
        const row = await z.settle(job.id);
        assert.equal(row.status, 'done', row.error);
        assert.match(row.media_path.split('/').pop(), /^CON- a-b--\d{8}-\d{4}\.zip$/);
        const zip = readZip(join(z.mediaRoot, row.media_path));
        assert.ok(zip.names.some((n) => n.startsWith('beats/01-_aux/_aux-take')), zip.names.join('\n'));
        if (existsSync(TAR)) {
            const listed = execFileSync(TAR, ['-tf', join(z.mediaRoot, row.media_path)], { encoding: 'utf8' }).trim().split(/\r?\n/);
            assert.deepEqual(listed.sort(), [...zip.names].sort());
        }
    } finally {
        await z.close();
    }
});
