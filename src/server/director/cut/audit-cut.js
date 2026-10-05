// The cut critic (03-director.md §6). Like audit.js it reports and never edits. It runs once per turn on what the
// turn changed (ledger.claimCutAudit) and rides on the tool result as "CHECK YOUR CUT"; audit_board adds the
// whole-cut list as THE CUT. The findings are the dock's own (cut/findings.js via cut-check.js), so the person and
// the Director see the same list. Every "what to do" is an edit propose_cut_ops can make, or a sentence to say:
// never render, generate or export, and never a control's name.

const s1 = (ms) => (Math.round(ms / 100) / 10).toFixed(1);
const who = (f) => f.beat_tag ?? 'The cut';

/** What the Director should do about each finding. */
const FIX = {
    GAP: (f) => `${who(f)} has no video. Name it in one sentence; do not offer to render it, and do not name any buttons.`,
    MISSING_FILE: (f) => `${who(f)}: its file is missing from the media folder, so it cannot play. Name the beat in one sentence.`,
    STALE: (f) => `${who(f)}: a newer take of it is ready. Say so in one sentence; place it (place with its take) only if they ask.`,
    TAKES: () => null,
    UNMEASURED: (f) => `${who(f)} was not measured, so its length is only the asked length. Set no times on it.`,
    ORDER_GUESSED: () => 'There is no plan, so the clips are in board order. Say so if the order matters.',
    MIXED_ASPECT: (f) => `${f.text} Say so in one sentence.`,
    RUNTIME_OFF: (f) => `${f.text} Say both numbers; trim or drop beats only if they asked for that length.`,
    OVER_RUNTIME: (f) => `${f.text} Tighten it with trims (inspect_cut shows what each clip can lose) or say which beat you would drop and ask.`,
    LINE_CUT_OFF: (f) => `${who(f)}: a spoken line (${s1(f.line[0])}–${s1(f.line[1])} s) is cut off at its ${f.edge === 'in' ? 'start' : 'end'}. Move the ${f.edge === 'in' ? 'in' : 'out'} point outside the line, or ${f.edge === 'in' ? 'start its sound early with a J cut' : 'let it run on with an L cut'}.`,
    DEAD_AIR: (f) => `${who(f)}: ${s1(f.span[1] - f.span[0])} s of still frames with nothing to hear (${s1(f.span[0])}–${s1(f.span[1])} s). Trim them, unless the stillness is the point.`,
    LOUDNESS_OFF: (f) => `${who(f)}: its sound is ${Math.abs(f.lu)} LU ${f.lu > 0 ? 'louder' : 'quieter'} than its neighbours. Turn its sound off if it is noise, or say so.`,
    MUSIC_ENDS_EARLY: (f) => `${f.text} The music never loops: tighten the picture to end with it, or say so.`,
    SHORT: (f) => `${who(f)}: the clip is ${s1(f.short_ms)} s shorter than its beat asked for. Say so in one sentence; it cannot be held longer than it runs.`,
    JUMP: (f) => `${f.text} A dissolve or a move would soften it; or say it is fine.`,
};

/** Findings as critic lines ("s4-run: …"), or [] — notes (TAKES) are left out. */
export function criticLines(findings) {
    return findings.map((f) => (FIX[f.code] ?? (() => `${who(f)}: ${f.text}`))(f)).filter(Boolean);
}

/**
 * The critic on the turn's own work: findings on the clips it changed, plus the ones about the whole cut.
 * @param {object[]} findings from checkCut()
 * @param {number[]|null} changed node ids the turn changed (null = all)
 * @returns {string|null}
 */
export function cutCheckText(findings, changed = null) {
    const scope = changed ? new Set(changed) : null;
    const mine = findings.filter((f) => !scope || f.node_id == null || scope.has(f.node_id));
    const lines = criticLines(mine);
    if (!lines.length) return null;
    return ['CHECK YOUR CUT — what the cut has now:', ...lines.map((l) => `- ${l}`),
        'Fix what you can with ONE more propose_cut_ops call, or say plainly what is left. Do not claim the cut is finished if a line above still holds.'].join('\n');
}

/** The cut's section for audit_board (whole cut, not the turn). */
export function cutSectionText(findings) {
    const lines = criticLines(findings);
    if (!lines.length) return 'THE CUT: nothing to fix.';
    return ['THE CUT:', ...lines.map((l) => `- ${l}`)].join('\n');
}
