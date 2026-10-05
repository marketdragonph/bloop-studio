// Where a piece plays and how long it runs (bloop's Destinations and BoardRuntime), with this app's clip lengths.

const DESTINATIONS = {
    tiktok: ['9:16', 'TikTok'], reels: ['9:16', 'Instagram Reels'], 'facebook reels': ['9:16', 'Facebook Reels'],
    'fb reels': ['9:16', 'Facebook Reels'], facebook: ['9:16', 'Facebook Reels'], shorts: ['9:16', 'YouTube Shorts'],
    stories: ['9:16', 'Stories'], 'facebook feed': ['4:5', 'the Facebook feed'], instagram: ['4:5', 'the Instagram feed'],
    feed: ['4:5', 'a social feed'], youtube: ['16:9', 'YouTube'], web: ['16:9', 'a website'],
    broadcast: ['16:9', 'broadcast'], cinema: ['16:9', 'the big screen'],
};
export const DESTINATION_KEYS = Object.keys(DESTINATIONS);

/** Exact key first, else the LONGEST key inside the words ("facebook reels" beats "facebook"); unknown = null. */
export function destination(words) {
    const text = String(words ?? '').toLowerCase().trim();
    if (!text) return null;
    const key = DESTINATIONS[text] ? text : DESTINATION_KEYS.filter((k) => text.includes(k)).sort((a, b) => b.length - a.length)[0];
    return key ? { key, aspect: DESTINATIONS[key][0], label: DESTINATIONS[key][1] } : null;
}

/** The one ratio every picture and clip card on the board shares, or null when mixed or none. */
export function aspectOnBoard(nodes) {
    const ratios = new Set(nodes.filter((n) => ['image', 'video'].includes(n.type) && n.settings?.aspect).map((n) => n.settings.aspect));
    return ratios.size === 1 ? [...ratios][0] : null;
}

/** The runtime field (BoardRuntime::field) with this board's ceiling. */
export const runtimeField = (ceiling) => ({
    type: 'integer',
    description: `How long the WHOLE piece runs, in seconds, when they named a length — "a 5 minute film" is 300, "a 90-second spot" is 90. SEND IT WHENEVER THEY SAID ONE, and again when they change it; leave it out when nobody named a length. ONE BEAT IS ONE CLIP and a clip runs ${ceiling} seconds at most, so the length decides how many beats there are: five beats can never make five minutes, and a scene that needs longer than that is consecutive beats.`,
});

export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Fewest and comfortable beat counts for a runtime, on clips of `lengths` seconds. */
export function runtimeShare(seconds, lengths) {
    const ceiling = Math.max(...lengths);
    const middle = [...lengths].sort((a, b) => a - b)[Math.floor((lengths.length - 1) / 2)];
    const fewest = Math.ceil(seconds / ceiling);
    return { seconds, ceiling, fewest, comfortable: Math.max(fewest, Math.ceil(seconds / middle)) };
}

/** BoardRuntime::forPlan — the arithmetic the plan turn is told. */
export function runtimeSaid(seconds, lengths) {
    if (!seconds) return '';
    const s = runtimeShare(seconds, lengths);
    return `\n\nTHE PIECE RUNS ${clock(seconds)}. One beat is one clip and a clip on this board runs ${s.ceiling} seconds at most, so that length takes AT LEAST ${s.fewest} beats, and about ${s.comfortable} at the length most beats need. Say the beat count in your approach and build that many: fewer than ${s.fewest} beats cannot reach ${clock(seconds)} however long each one runs, and the build will refuse it.`;
}
