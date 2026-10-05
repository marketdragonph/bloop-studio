// The Director panel follows a run through the board's event stream. A fast turn (a local model, a refusal) can
// stream and even finish before the POST that started it answers: the panel must keep one reply and settle, never
// sit on "Working" with a second empty bubble (found in the Mini Katana final gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directorMethods } from '../public/js/board/director.js';

function panel() {
    const board = Object.create(directorMethods);
    Object.assign(board, {
        base: '/spaces/2', directorInput: '', directorBusy: false, directorRunId: null, directorLog: [], directorLoaded: true,
        $nextTick: (fn) => fn(), $refs: {}, refreshBoard: async () => {}, toast: () => {},
    });
    return board;
}

function postAnswering(runId, beforeAnswer) {
    globalThis.document = { querySelector: () => null };
    globalThis.fetch = async () => {
        beforeAnswer();
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ runId }), text: async () => JSON.stringify({ runId }) };
    };
}

test('a turn that finishes before the POST answers leaves one settled reply and the panel idle', async () => {
    const board = panel();
    postAnswering(7, () => {
        board.onDirectorStream({ runId: 7, event: 'text', data: { delta: 'Took half a second off the end.' } });
        board.onDirectorStream({ runId: 7, event: 'done', data: {} });
    });
    board.directorInput = 'tighten s2';
    await board.sendDirector();
    const replies = board.directorLog.filter((entry) => entry.runId === 7);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].streaming, false);
    assert.equal(replies[0].text, 'Took half a second off the end.');
    assert.equal(board.directorBusy, false);
    assert.equal(board.directorRunId, null);
});

test('a turn that started streaming before the POST answers keeps its one bubble and stays busy until done', async () => {
    const board = panel();
    postAnswering(8, () => board.onDirectorStream({ runId: 8, event: 'text', data: { delta: 'Reading' } }));
    board.directorInput = 'cut it together';
    await board.sendDirector();
    assert.equal(board.directorLog.filter((entry) => entry.runId === 8).length, 1);
    assert.equal(board.directorBusy, true);
    board.onDirectorStream({ runId: 8, event: 'done', data: {} });
    assert.equal(board.directorBusy, false);
});

test('the usual order (POST answers first) is unchanged', async () => {
    const board = panel();
    postAnswering(9, () => {});
    board.directorInput = 'hello';
    await board.sendDirector();
    assert.equal(board.directorLog.filter((entry) => entry.runId === 9).length, 1);
    assert.equal(board.directorBusy, true);
    board.onDirectorStream({ runId: 9, event: 'text', data: { delta: 'Hi.' } });
    board.onDirectorStream({ runId: 9, event: 'done', data: {} });
    assert.equal(board.directorLog.find((entry) => entry.runId === 9).text, 'Hi.');
    assert.equal(board.directorBusy, false);
});
