// What each updater event does to the state the top bar and Settings show. Kept apart from electron-updater so the
// rules are testable. The one rule that matters: a downloaded update stays "ready" (the top bar's Restart key)
// whatever a later check says, so the 30-minute re-check or a GitHub hiccup never hides it.

const IN_HAND = new Set(['downloading', 'ready']);

/** The new state after `event` ('checking' | 'available' | 'progress' | 'downloaded' | 'current' | 'error'). */
export function applyUpdateEvent(state, event, payload = {}) {
    const ready = state.status === 'ready';
    switch (event) {
        case 'checking':
            return IN_HAND.has(state.status) ? state : { ...state, status: 'checking', error: null };
        case 'available':
            // The same version again (the re-check of a download already done) changes nothing.
            if (ready && payload.version === state.available) return state;
            return { ...state, status: 'downloading', available: payload.version, progress: 0, error: null };
        case 'progress':
            return ready ? state : { ...state, status: 'downloading', progress: payload.percent / 100 };
        case 'downloaded':
            return { ...state, status: 'ready', available: payload.version, progress: 1, error: null };
        case 'current':
            return ready ? state : { ...state, status: 'current', error: null };
        case 'error':
            return { ...state, status: ready ? 'ready' : 'error', error: payload.message };
        default:
            return state;
    }
}
