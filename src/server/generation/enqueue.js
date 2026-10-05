// THE per-card render path: a card's Generate key and Render missing beats both queue through here, so a card
// queued by either renders the same way. A card with no Model pick renders on the first family its list offers
// (card-source.js), so the press matches what the card shows. The GPU worker claims the job; nothing waits here.

/**
 * @param {{ spaces: import('../repositories/spaces.js').SpacesRepository, jobs: import('../repositories/jobs.js').JobsRepository,
 *   events: import('./events.js').BoardEvents }} deps
 * @param {object} node a card on the board (image, video or audio)
 * @param {{ family?: string|null, announce?: boolean }} [options] `family`: the first offered family, for a card with no pick.
 *   `announce: false` skips the queue event (a batch sends one at the end).
 * @returns {{ job: object, node: object, position: number }}
 */
export function queueCard({ spaces, jobs, events }, node, { family = null, announce = true } = {}) {
    let card = node;
    if (!card.settings?.family && family) card = spaces.updateNode(card.space_id, card.id, { settings: { family } });
    const job = jobs.enqueue({ nodeId: card.id, preset: card.settings?.family ?? 'auto' });
    spaces.setNodeResult(card.id, { status: 'queued' });
    events.node({ spaceId: card.space_id, nodeId: card.id, status: 'queued' });
    if (announce) events.queue(jobs.activeQueue());
    return { job, node: card, position: jobs.queuePosition(job.id) };
}
