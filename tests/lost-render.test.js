import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollUntilDone } from '../src/server/generation/stages.js';

test('a render ComfyUI no longer has (restarted) fails with words, instead of waiting forever', async () => {
    const gone = { history: async () => null, queueHas: async () => false };
    await assert.rejects(pollUntilDone(gone, 'p1', {}, 1), /ComfyUI lost this render/);
});

test('a render still queued, or briefly between queue and history, keeps waiting', async () => {
    let calls = 0;
    const comfy = {
        history: async () => (++calls >= 4 ? { status: { completed: true } } : null),
        queueHas: async () => calls === 2, // once out of the queue before it lands in the history
    };
    await pollUntilDone(comfy, 'p2', {}, 1);
    assert.equal(calls, 4);
    const silent = { history: async () => null, queueHas: async () => { throw new Error('busy'); } };
    const ctx = {};
    setTimeout(() => { ctx.done = true; }, 30);
    await pollUntilDone(silent, 'p3', ctx, 5); // a ComfyUI that does not answer is never counted as lost
});
