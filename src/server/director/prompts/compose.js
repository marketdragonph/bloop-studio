// The system prompt, in bloop's order: doctrine first (byte-identical across turns, so providers cache it), then
// the board state LAST (BuildStagesPrompt, then the board snapshot). Blocks are concatenated as they are; each
// brings its own leading blank lines.
import { MAX_NODES_PER_SPACE } from '../../../shared/node-types.js';
import { stateOf } from '../card-state.js';
import { BEAT_CAST, BREVITY, CINEMATOGRAPHY, CRAFT_ROLES, PLATE_SHEET, PROP_FACING, STORY_CRAFT, STORY_ENDS, boardRuntime, clipLength, look, orientation, spectacle } from './doctrine-craft.js';
import { OPS_CONTRACT, PERSONA, RECIPES, VOCABULARY } from './doctrine-board.js';
import { CAST_NAMES, GUIDE, PLAN_FIRST, buildStages } from './doctrine-plan.js';
import { SOUND_CRAFT, VOICE_PROFILE, voiceCraft } from './doctrine-voice.js';
import { EDIT_CRAFT, editStyle } from './doctrine-edit.js';

const BUDGET = 24_000;
const PLACEHOLDER = /^(untitled|new (space|board)|test|demo|space \d+|board \d+)$/i;

export const isPlaceholderName = (name) => {
    const n = String(name ?? '').trim();
    return n.length <= 2 || !/[a-z]/i.test(n) || PLACEHOLDER.test(n) || /\((copy|imported)\)$/i.test(n);
};

const clip = (text, n) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** BoardSnapshot: one line per card, top to bottom, with what feeds it; text clipped to fit the budget. */
export function boardSnapshot({ space, nodes, connections }) {
    const name = space?.name ?? '';
    const flags = [isPlaceholderName(name) && 'a placeholder name', !space?.description && 'no description'].filter(Boolean);
    const nameLine = `Board name: "${name}"${space?.description ? ` — description: "${clip(space.description, 200)}"` : ''}${flags.length ? ` (${flags.join(', ')}).` : '.'}`;
    if (!nodes.length) return `THE BOARD IS EMPTY. Nothing has been made yet.\n${nameLine}`;
    const ordered = [...nodes].sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x);
    const lineFor = (n, room) => {
        const parts = [`@${n.id}`, n.type];
        if (n.label) parts.push(JSON.stringify(clip(n.label, 60)));
        for (const k of ['family', 'aspect', 'duration', 'resolution']) if (n.settings?.[k] !== undefined) parts.push(`${k}=${n.settings[k]}`);
        if (room && n.text_content) parts.push(`text=${JSON.stringify(clip(n.text_content, room))}`);
        if (['image', 'video', 'audio'].includes(n.type)) parts.push(stateOf(n).replace('rendering now', 'rendering-now').replace('not rendered yet', 'unrendered'));
        const feeds = connections.filter((c) => c.to_node_id === n.id).map((c) => `@${c.from_node_id}${c.to_socket && c.to_socket !== 'prompt' ? ` (${c.to_socket})` : ''}`);
        if (feeds.length) parts.push(`← ${feeds.join(' ')}`);
        return parts.join(' ');
    };
    let room = 160;
    let lines = ordered.map((n) => lineFor(n, room));
    for (const next of [60, 0]) {
        if (lines.join('\n').length <= BUDGET) break;
        room = next;
        lines = ordered.map((n) => lineFor(n, room));
    }
    const note = room === 60 ? '\nThis board is large, so text is shortened harder than usual.'
        : room === 0 ? '\nThis board is large, so text is NOT shown. Read a card with inspect_board before rewriting it.' : '';
    return `THE BOARD RIGHT NOW — ${nodes.length} card${nodes.length === 1 ? '' : 's'}, ${connections.length} wire${connections.length === 1 ? '' : 's'}, room for ${MAX_NODES_PER_SPACE - nodes.length} more.\n${nameLine}\nAddress any of these as \`@<id>\`; \`←\` lists what feeds it.${note}\n\n${lines.join('\n')}`;
}

/**
 * ctx: { space, board, plan, owed, intent, aspect, lengths (clip seconds menu), withSound }.
 * withSound: the board's clips are made on a model that makes its own sound (LTX-2.3, MiniMax-H3).
 */
export function systemPrompt(ctx) {
    const { plan, intent = {}, lengths = [3, 5, 8, 10], withSound = true } = ctx;
    const beats = ctx.beatCount ?? 0;
    return [
        PERSONA,
        VOCABULARY,
        OPS_CONTRACT,
        `\n${CAST_NAMES}\n`,
        RECIPES,
        CRAFT_ROLES,
        orientation(ctx.aspect),
        CINEMATOGRAPHY,
        BREVITY,
        spectacle(intent.register),
        BEAT_CAST,
        STORY_ENDS,
        clipLength(lengths),
        boardRuntime(plan?.runtime_seconds, beats, Math.max(...lengths)),
        withSound ? SOUND_CRAFT : '',
        withSound ? VOICE_PROFILE : '',
        voiceCraft(intent.language),
        PROP_FACING,
        look(intent.look),
        STORY_CRAFT,
        EDIT_CRAFT,
        editStyle(ctx.editStyle),
        PLATE_SHEET,
        PLAN_FIRST,
        GUIDE,
        // ── board state below: not cache-stable ──
        buildStages(plan, ctx.owed ?? []),
        `\n${boardSnapshot({ space: ctx.space, nodes: ctx.board.nodes, connections: ctx.board.connections })}\n`,
        cutSnapshot(ctx.cut),
    ].join('');
}

const GAP_WORDS = { never_rendered: 'never rendered', failed: 'render failed', card_deleted: 'card deleted', file_missing: 'file missing', rendering: 'rendering now' };

/**
 * The Cut's lines after the board snapshot (03 §2, 05 §1.1, §4.3): the snapshot line (verbatim format), then only
 * when needed the lock line, the gaps with their reasons, and the beats' roles. Empty when the board has no clips
 * and no cut. `cut` comes from director/cut/cut-state.js.
 */
export function cutSnapshot(cut) {
    if (!cut || (!cut.beats && !cut.items)) return '';
    const lines = [`Cut: ${cut.inCut} of ${cut.beats} beats, ${cut.clock}, revision ${cut.revision}`];
    if (cut.locked.length) lines.push(`Locked (the person changed them since): ${cut.locked.join(', ')}.`);
    if (cut.gaps.length) lines.push(`Gaps: ${cut.gaps.map((g) => `${g.tag} (${GAP_WORDS[g.reason] ?? 'no video'})`).join(', ')}.`);
    if (cut.roles.length) lines.push(`Roles: ${cut.roles.map((r) => `${r.tag} ${r.role}`).join(', ')}.`);
    return `\n${lines.join('\n')}\n`;
}
