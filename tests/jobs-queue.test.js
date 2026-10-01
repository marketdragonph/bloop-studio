import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { JobsRepository } from '../src/server/repositories/jobs.js';

function fresh() {
    const db = openDatabase(':memory:');
    const spaces = new SpacesRepository(db);
    const jobs = new JobsRepository(db);
    const space = spaces.create({ name: 'Queue test' });
    const queue = (node) => {
        spaces.setNodeResult(node.id, { status: 'queued' });
        return jobs.enqueue({ nodeId: node.id, preset: 'auto' });
    };
    return { spaces, jobs, space, queue };
}

test('a video waits for the still wired into its first frame', () => {
    const { spaces, jobs, space, queue } = fresh();
    const still = spaces.createNode(space.id, { type: 'image' });
    const clip = spaces.createNode(space.id, { type: 'video' });
    spaces.connect(space.id, still.id, clip.id);
    queue(clip); // queued first…
    queue(still);
    const first = jobs.claimNext();
    assert.equal(first.node_id, still.id, '…but the still must run first');
    assert.equal(jobs.claimNext(), null, 'the clip is blocked while the still renders');
    spaces.setNodeResult(still.id, { status: 'done', media_path: 'x.png', media_mime: 'image/png' });
    jobs.finish(first.id, 'succeeded');
    assert.equal(jobs.claimNext().node_id, clip.id);
});

test('among ready jobs the loaded model family goes first', () => {
    const { spaces, jobs, space, queue } = fresh();
    const a = spaces.createNode(space.id, { type: 'image' });
    const b = spaces.createNode(space.id, { type: 'video' });
    spaces.updateNode(space.id, b.id, { settings: { family: 'h3' } });
    queue(a);
    queue(b);
    const familyOf = (j) => JSON.parse(j.node_settings).family ?? (j.node_type === 'image' ? 'zimage' : 'wan5b');
    assert.equal(jobs.claimNext({ preferFamily: 'h3', familyOf }).node_id, b.id);
});

test('a queued job whose card was deleted is canceled, not stuck', () => {
    const { spaces, jobs, space, queue } = fresh();
    const card = spaces.createNode(space.id, { type: 'image' });
    const job = queue(card);
    spaces.deleteNode(space.id, card.id);
    assert.equal(jobs.claimNext(), null);
    assert.equal(jobs.find(job.id).status, 'canceled');
});

test('the active queue lists the running render first, then the waiting ones by age', () => {
    const { spaces, jobs, space, queue } = fresh();
    const [a, b, c] = ['image', 'image', 'image'].map((type) => spaces.createNode(space.id, { type }));
    queue(a);
    queue(b);
    queue(c);
    jobs.claimNext(); // a starts running
    assert.deepEqual(jobs.activeQueue().map((j) => [j.nodeId, j.status, j.spaceId]), [
        [a.id, 'running', space.id],
        [b.id, 'queued', space.id],
        [c.id, 'queued', space.id],
    ]);
});

test('a restart re-queues running work and hands back its orphaned ComfyUI prompt', () => {
    const { spaces, jobs, space, queue } = fresh();
    const still = spaces.createNode(space.id, { type: 'image' });
    queue(still);
    const job = jobs.claimNext();
    jobs.setPromptId(job.id, 'prompt-abc');
    assert.deepEqual(jobs.requeueInterrupted(), { changes: 1, orphans: ['prompt-abc'] });
    assert.equal(jobs.find(job.id).status, 'queued');
});
