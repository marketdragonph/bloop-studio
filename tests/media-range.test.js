import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generationRoutes } from '../src/server/routes/generation.js';
import { MediaStore } from '../src/server/generation/media-store.js';
import { parseByteRange } from '../src/server/media/byte-range.js';

let root;
let routes;
const SIZE = 1024 * 1024;
const bytes = Buffer.alloc(SIZE, 0).map((_, i) => i % 251);

before(async () => {
    root = await mkdtemp(join(tmpdir(), 'bloop-range-'));
    await mkdir(join(root, 'spaces', '1'), { recursive: true });
    await writeFile(join(root, 'spaces', '1', 'clip.mp4'), bytes);
    await writeFile(join(root, 'spaces', '1', 'empty.mp4'), Buffer.alloc(0));
    const media = new MediaStore(() => root);
    // Serving must stream; reading the whole file into memory is the bug this guards against.
    media.read = () => {
        throw new Error('media.read must not be used to serve a file');
    };
    routes = generationRoutes({ media });
});

after(() => rm(root, { recursive: true, force: true }));

const get = (path, headers = {}) => routes.request(path, { headers });

test('no Range: 200 with the whole file and accept-ranges', async () => {
    const res = await get('/media/spaces/1/clip.mp4');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-length'), String(SIZE));
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
});

test('a Range gets 206 with exactly that slice', async () => {
    const res = await get('/media/spaces/1/clip.mp4', { range: 'bytes=1000-1999' });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 1000-1999/${SIZE}`);
    assert.equal(res.headers.get('content-length'), '1000');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes.subarray(1000, 2000));
});

test('open-ended and suffix ranges', async () => {
    const open = await get('/media/spaces/1/clip.mp4', { range: `bytes=${SIZE - 10}-` });
    assert.equal(open.status, 206);
    assert.deepEqual(Buffer.from(await open.arrayBuffer()), bytes.subarray(SIZE - 10));

    const suffix = await get('/media/spaces/1/clip.mp4', { range: 'bytes=-5' });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-range'), `bytes ${SIZE - 5}-${SIZE - 1}/${SIZE}`);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(SIZE - 5));
});

test('an end past the file is clipped to the last byte', async () => {
    const res = await get('/media/spaces/1/clip.mp4', { range: `bytes=${SIZE - 3}-${SIZE + 500}` });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes ${SIZE - 3}-${SIZE - 1}/${SIZE}`);
});

test('a bad range is 416 with the size', async () => {
    for (const range of [`bytes=${SIZE}-`, 'bytes=50-10', 'bytes=abc', 'bytes=-0', 'bytes=0-1,5-9']) {
        const res = await get('/media/spaces/1/clip.mp4', { range });
        assert.equal(res.status, 416, range);
        assert.equal(res.headers.get('content-range'), `bytes */${SIZE}`);
    }
});

test('?download= still sets the attachment name, also on a range', async () => {
    const res = await get('/media/spaces/1/clip.mp4?download=My%20clip', { range: 'bytes=0-9' });
    assert.equal(res.status, 206);
    assert.match(res.headers.get('content-disposition'), /attachment; filename\*=UTF-8''My%20clip\.mp4/);
});

test('an empty file is a 200 with no body', async () => {
    const res = await get('/media/spaces/1/empty.mp4');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '0');
});

test('paths outside the media folder and missing files are 404', async () => {
    assert.equal((await get('/media/..%2F..%2Fwindows%2Fwin.ini')).status, 404);
    assert.equal((await get('/media/spaces/1/nope.mp4')).status, 404);
    assert.equal((await get('/media/spaces/1')).status, 404);
});

test('parseByteRange: other units are ignored', () => {
    assert.equal(parseByteRange(undefined, 10), null);
    assert.equal(parseByteRange('items=0-1', 10), null);
    assert.deepEqual(parseByteRange('bytes=0-0', 10), { start: 0, end: 0 });
    assert.equal(parseByteRange('bytes=0-', 0), 'unsatisfiable');
});
