// What the system prompt says about the Cut (03 §2 snapshot line, 05 §1.1 roles, 05 §4.3 gap reasons), read once
// per turn from the stored cut and BoardCut. compose.js turns it into lines; nothing here writes.
import { cutClock } from '../../../shared/cut-clock.js';
import { isLocked } from './lock.js';

const pad = (n) => String(n).padStart(2, '0');
const clockText = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
export const ROLES = Object.freeze(['hook', 'setup', 'turn', 'climax', 'close']);

/**
 * @param {{ cuts: object, boardCut: object, plans: object }} deps
 * @param {number} spaceId
 * @param {object|null} plan the board's latest plan
 * @returns {{ beats: number, inCut: number, items: number, clock: string, revision: number, locked: string[], gaps: {tag: string, reason: string}[], roles: {tag: string, role: string}[] }}
 */
export function cutState({ cuts, boardCut, plans }, spaceId, plan) {
    const cut = cuts.current(spaceId);
    const read = boardCut.read(spaceId, { cut });
    const inCut = new Set(cut.items.map((i) => i.node_id));
    const beats = plan ? plans.beats(plan.id) : [];
    return {
        beats: read.slots.length,
        inCut: read.slots.filter((s) => s.node_id && inCut.has(s.node_id)).length,
        items: cut.items.length,
        clock: clockText(cutClock(cut.items).total_ms),
        revision: cut.revision,
        locked: [...new Set(cut.items.filter(isLocked).map((i) => i.beat_tag ?? `@${i.node_id}`))],
        gaps: read.slots.filter((s) => s.state !== 'ready').map((s) => ({ tag: s.beat_tag, reason: s.reason ?? 'never_rendered' })),
        roles: beats.filter((b) => ROLES.includes(b.staging?.role)).map((b) => ({ tag: b.tag, role: b.staging.role })),
    };
}
