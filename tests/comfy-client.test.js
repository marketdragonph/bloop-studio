import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ComfyClient } from '../src/server/services/comfy-client.js';

/** A fake ComfyUI: /free and /interrupt answer 200 with an empty body, like the real one. */
async function fakeComfy() {
    const server = createServer((req, res) => {
        if (req.url === '/free' || req.url === '/interrupt') return res.writeHead(200).end();
        if (req.url === '/system_stats') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ system: { comfyui_version: 'fake' }, devices: [{ name: 'cuda:0 Fake GPU : native', vram_total: 2 ** 34, vram_free: 2 ** 33 }] }));
        if (req.url === '/queue') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"queue_running":[],"queue_pending":[]}');
        return res.writeHead(404).end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('empty 200 bodies (/free) do not throw "Unexpected end of JSON input"', async () => {
    const { server, url } = await fakeComfy();
    try {
        const comfy = new ComfyClient(url);
        await comfy.free();
        const status = await comfy.status();
        assert.equal(status.online, true);
        assert.equal(status.gpu, 'Fake GPU');
    } finally {
        server.close();
    }
});

test('status reports offline instead of throwing when ComfyUI is not there', async () => {
    const status = await new ComfyClient('http://127.0.0.1:9').status();
    assert.equal(status.online, false);
});
