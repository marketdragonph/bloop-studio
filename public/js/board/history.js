// Undo/redo as commands { label, undo, redo }. Both directions are explicit functions
// (bloop's connection redo re-ran a drag handler that exited early, so redo did nothing).
// Kept in a closure, never in Alpine state, so a push never wakes a reactive effect.
export function createHistory({ limit = 50, onChange = () => {} } = {}) {
    const done = [];
    const undone = [];
    let busy = false;

    const run = async (from, to, direction) => {
        if (busy || !from.length) return;
        busy = true;
        const command = from.pop();
        try {
            await command[direction]();
            to.push(command);
        } catch (error) {
            from.push(command); // keep it: the board did not change
            throw error;
        } finally {
            busy = false;
            onChange();
        }
    };

    return {
        push(command) {
            done.push(command);
            if (done.length > limit) done.shift();
            undone.length = 0;
            onChange();
        },
        undo: () => run(done, undone, 'undo'),
        redo: () => run(undone, done, 'redo'),
        canUndo: () => done.length > 0,
        canRedo: () => undone.length > 0,
        nextUndoLabel: () => done.at(-1)?.label ?? null,
    };
}
