// CutOpsValidator (03-director.md §3): every reason an op list is refused on its own shape, collected before
// anything is read or applied, in the wording style of bloop's BoardOpsValidator. What depends on the cut (the
// beat exists, the clip is long enough, the lock) is checked by cut-ops.js against the cut, also before any write.
import { DISSOLVE, DUCK, MUSIC_LEVEL, TARGET_LUFS, WHY_MAX, CUT_LIMITS } from '../../../shared/cut-rules.js';

export const CUT_OPS = ['place', 'trim', 'move', 'remove', 'join', 'sound', 'duck', 'level', 'snap', 'poster', 'undo_turn'];
export const MAX_CUT_OPS = 40;
export const TRACKS = ['music', 'voice', 'clips'];
export const UNDO_KINDS = ['trim', 'join', 'sound', 'duck', 'level'];
/** Ops that set a time and need measured clips (no video tools: refused). */
export const TIMED = new Set(['trim', 'duck', 'snap']);
const NEEDS_WHY = new Set(['trim', 'move', 'join']);
const NEEDS_BEAT = new Set(['place', 'trim', 'move', 'remove', 'join', 'sound', 'snap', 'poster']);

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Every shape problem with an op list, or [] when it can be read. */
export function shapeProblems(ops) {
    if (!Array.isArray(ops) || !ops.length) return ['`ops` must be a non-empty list of cut operations.'];
    if (ops.length > MAX_CUT_OPS) return [`Too many operations (${ops.length}) — the limit is ${MAX_CUT_OPS} in one call. Send the most important ones.`];
    const reasons = [];
    ops.forEach((op, i) => {
        const n = i + 1;
        if (!op || typeof op !== 'object' || Array.isArray(op)) return reasons.push(`op ${n} is not an object.`);
        if (!CUT_OPS.includes(op.op)) return reasons.push(`op ${n}: there is no \`${op.op ?? ''}\` operation. Use one of: ${CUT_OPS.join(', ')}.`);
        if (NEEDS_BEAT.has(op.op) && (typeof op.beat !== 'string' || !op.beat.trim())) reasons.push(`op ${n}: \`beat\` names the clip, by its beat tag (s3-door) or @<id> of its card.`);
        if (NEEDS_WHY.has(op.op)) {
            if (typeof op.why !== 'string' || !op.why.trim()) reasons.push(`op ${n}: say why, from the measured numbers (\`why\`, one short sentence).`);
            else if (op.why.length > WHY_MAX) reasons.push(`op ${n}: \`why\` is at most ${WHY_MAX} characters.`);
        }
        if (op.op === 'trim') {
            if (op.in_s === undefined && op.out_s === undefined) reasons.push(`op ${n}: a trim sets \`in_s\`, \`out_s\` or both, in seconds into the clip.`);
            for (const k of ['in_s', 'out_s']) if (op[k] !== undefined && (!num(op[k]) || op[k] < 0)) reasons.push(`op ${n}: \`${k}\` is seconds into the clip, 0 or more, in 0.1 steps.`);
        }
        if ((op.op === 'move' || op.op === 'place') && op.after !== undefined && (typeof op.after !== 'string' || !op.after.trim())) {
            reasons.push(`op ${n}: \`after\` is the beat it follows, or "start".`);
        }
        if (op.op === 'move' && op.after === undefined) reasons.push(`op ${n}: a move needs \`after\` — the beat it follows, or "start".`);
        if (op.op === 'place' && op.take !== undefined && !/^@\d+$/.test(String(op.take))) reasons.push(`op ${n}: \`take\` is @<id> of an older take.`);
        if (op.op === 'join') {
            if (!['cut', 'dissolve'].includes(op.type)) reasons.push(`op ${n}: a join is \`type\` "cut" or "dissolve".`);
            if (op.ms !== undefined && (!Number.isInteger(op.ms) || op.ms < DISSOLVE.min || op.ms > DISSOLVE.max)) reasons.push(`op ${n}: a dissolve is ${DISSOLVE.min} to ${DISSOLVE.max} ms.`);
            if (op.ms !== undefined && op.type === 'cut') reasons.push(`op ${n}: \`ms\` is only for a dissolve.`);
            if (op.audio_ms !== undefined) {
                if (!Number.isInteger(op.audio_ms) || Math.abs(op.audio_ms) > CUT_LIMITS.jlMaxMs) reasons.push(`op ${n}: \`audio_ms\` is -1500 to 1500 (J cut below 0, L cut above).`);
                else if (op.type === 'dissolve' && op.audio_ms !== 0) reasons.push(`op ${n}: a J or L cut sits only on a cut, never on a dissolve.`);
            }
        }
        if (op.op === 'sound' && typeof op.on !== 'boolean') reasons.push(`op ${n}: \`on\` is true or false — the clip's own sound.`);
        if (op.op === 'duck' && (!num(op.depth_db) || op.depth_db > DUCK.max || op.depth_db < DUCK.min)) reasons.push(`op ${n}: \`depth_db\` is ${DUCK.max} to ${DUCK.min} dB.`);
        if (op.op === 'level') {
            if (op.target_lufs === undefined && !TRACKS.includes(op.track)) reasons.push(`op ${n}: \`track\` is music, voice or clips (or send only \`target_lufs\`).`);
            if (op.track !== undefined && op.gain_db === undefined) reasons.push(`op ${n}: a track level needs \`gain_db\`.`);
            if (op.gain_db !== undefined && (!num(op.gain_db) || op.gain_db < MUSIC_LEVEL.min || op.gain_db > MUSIC_LEVEL.max)) reasons.push(`op ${n}: \`gain_db\` is ${MUSIC_LEVEL.min} to +${MUSIC_LEVEL.max}.`);
            if (op.target_lufs !== undefined && !TARGET_LUFS.includes(op.target_lufs)) reasons.push(`op ${n}: \`target_lufs\` is one of ${TARGET_LUFS.join(', ')}.`);
        }
        if (op.op === 'poster' && op.at_s !== undefined && (!num(op.at_s) || op.at_s < 0)) reasons.push(`op ${n}: \`at_s\` is seconds into the clip.`);
        if (op.op === 'undo_turn') {
            if (ops.length > 1) reasons.push(`op ${n}: undo_turn goes alone in its call.`);
            if (op.kinds !== undefined && (!Array.isArray(op.kinds) || !op.kinds.length || op.kinds.some((k) => !UNDO_KINDS.includes(k)))) {
                reasons.push(`op ${n}: \`kinds\` lists what to take back: ${UNDO_KINDS.join(', ')} (moves, places and removes go back only with the whole turn).`);
            }
        }
    });
    return reasons;
}

/** The refusal as the model reads it (CutOpsRejected::forModel). */
export const refusedText = (reasons) => `NOTHING was changed in the cut — the whole op list was refused:\n- ${reasons.join('\n- ')}\n\nFix these and send propose_cut_ops again, or say plainly what you need from the person. Do not tell them it worked.`;

export class CutOpsRejected extends Error {
    constructor(reasons) {
        super(reasons.join(' '));
        this.reasons = reasons;
    }

    forModel() {
        return refusedText(this.reasons);
    }
}
