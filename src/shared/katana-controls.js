// THE ONE REGISTRY of Katana's controls (docs/plans/katana/05-irresistible.md §4.1). It feeds three places that
// must never disagree: the Director's guide (src/server/director/prompts/guide-katana.js), the dock's labels in
// the Edge views (each control's element carries data-control="<id>"), and the dock's keyboard shortcuts.
// tests/katana-guide.test.js fails on any drift. Shared by the server and the browser; no Node or DOM APIs.
//
// Entry: { id, surface: 'dock' | 'katana' | 'board' | 'settings', label, where, does, keys?, phase }.
// `phase` is when the control ships (src/shared/katana-phases.js); unshipped entries never reach the guide.

/** Keyboard shortcuts inside the dock. cut-dock.js imports these, so the keys and the guide cannot disagree. */
export const KEYS = Object.freeze({
    play: 'Space',
    inPoint: '[',
    outPoint: ']',
    join: 'D',
    mute: 'M',
    remove: 'Delete',
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Shift+Z',
    nudge: 'Shift+Arrow',
    move: 'Alt+Arrow',
});

const c = (id, surface, label, where, does, phase, keys = null) => Object.freeze({ id, surface, label, where, does, phase, keys });

export const CONTROLS = Object.freeze([
    // ── P1: the read-only dock ──
    c('cut.dock', 'dock', 'Cut', 'the dock at the bottom of a Space', 'shows the board\'s beats as one cut, in beat order', 'P1'),
    c('cut.fold', 'dock', 'Fold', 'the right end of the Cut\'s rail', 'opens the dock, or folds it to one line', 'P1'),
    c('cut.lane.video', 'dock', 'Video', 'the first lane of the open dock', 'holds one clip per beat, hatched where a beat has no video yet', 'P1'),
    c('cut.lane.voice', 'dock', 'Voice', 'the lane under Video', 'holds the voice bed', 'P1'),
    c('cut.lane.music', 'dock', 'Music', 'the lane under Voice', 'holds the music bed', 'P1'),
    c('cut.goToCard', 'dock', 'Go to card', 'on a hatched slot', 'pans the board to that beat\'s card', 'P1'),
    c('cut.clip', 'dock', 'Clip', 'the Video lane', 'shows that clip\'s frame next to the lanes', 'P1'),
    c('cut.retry', 'dock', 'Retry', 'the dock, when the cut could not load', 'loads the cut again', 'P1'),
    c('cut.askDirector', 'dock', 'Ask the Director', 'the empty dock and the empty board, with a Director key', 'opens the Director panel with its box ready', 'P1'),
    // ── P2: editing and preview ──
    c('cut.preview', 'dock', 'Preview', 'the left of the open dock', 'plays the cut', 'P2'),
    c('cut.play', 'dock', 'Play', 'the rail and the preview', 'plays or pauses the cut', 'P2', KEYS.play),
    c('cut.asExported', 'dock', 'As exported', 'under the preview', 'plays the cut without its gaps', 'P2'),
    c('cut.fill', 'dock', 'Fill the cut', 'the empty dock', 'puts every rendered beat in, in order', 'P2'),
    c('cut.inPoint', 'dock', 'Set in', 'a selected clip', 'sets the clip\'s in point at the playhead', 'P2', KEYS.inPoint),
    c('cut.outPoint', 'dock', 'Set out', 'a selected clip', 'sets the clip\'s out point at the playhead', 'P2', KEYS.outPoint),
    c('cut.join', 'dock', 'Join', 'the chip between two clips', 'switches cut and dissolve', 'P2', KEYS.join),
    c('cut.mute', 'dock', 'Clip sound', 'a selected clip', 'turns the clip\'s own sound off or on', 'P2', KEYS.mute),
    c('cut.remove', 'dock', 'Remove from cut', 'a selected clip', 'takes the clip out of the cut, never off the board', 'P2', KEYS.remove),
    c('cut.undo', 'dock', 'Undo', 'the rail', 'undoes the last edit in the dock', 'P2', KEYS.undo),
    c('cut.redo', 'dock', 'Redo', 'the rail', 'redoes it', 'P2', KEYS.redo),
    c('cut.fit', 'dock', 'Fit', 'the rail', 'fits the cut to the lane', 'P2'),
    c('cut.level', 'dock', 'Level', 'the Music and Voice lanes', 'sets the bed\'s level', 'P2'),
    c('cut.useNewer', 'dock', 'Use the newer version', 'the banner after a change in another window', 'takes the saved cut', 'P2'),
    c('cut.keepMine', 'dock', 'Keep mine', 'the same banner', 'keeps the cut on screen and saves it', 'P2'),
    c('cut.useNewTake', 'dock', 'Use new take', 'a clip with a newer take', 'swaps the newer take in', 'P2'),
    c('cut.moveLeft', 'dock', 'Move left', 'a selected clip\'s details', 'moves the clip one place earlier', 'P2', KEYS.move),
    c('cut.moveRight', 'dock', 'Move right', 'a selected clip\'s details', 'moves the clip one place later', 'P2', KEYS.move),
    c('cut.trimIn', 'dock', 'Trim in', 'the left handle of a selected clip', 'moves where the clip starts', 'P2', KEYS.nudge),
    c('cut.trimOut', 'dock', 'Trim out', 'the right handle of a selected clip', 'moves where the clip ends', 'P2', KEYS.nudge),
    c('cut.saveRetry', 'dock', 'Retry', 'the rail, when the cut was not saved', 'saves the cut again', 'P2'),
    c('cut.restore', 'dock', 'Restore', 'the banner when unsaved changes were found', 'puts the unsaved changes back', 'P2'),
    c('cut.discard', 'dock', 'Discard', 'the same banner', 'drops the unsaved changes', 'P2'),
    c('cut.replace', 'dock', 'Replace my cut', 'the banner when a fresh draft is ready', 'puts the fresh draft in place of the cut', 'P2'),
    // ── P2b: first run ──
    c('cut.addNew', 'dock', 'Add new clips', 'the rail, once the cut was edited', 'adds clips that landed since', 'P2b'),
    c('cut.renderMissing', 'dock', 'Render missing beats', "the rail and the board's render readout when beats have no video", 'opens a sheet with what it would queue', 'P2b'),
    c('cut.renderConfirm', 'dock', 'Render', 'the Render missing beats sheet', 'queues every card the plan still needs, one at a time', 'P2b'),
    c('cut.renderNotNow', 'dock', 'Not now', 'the Render missing beats sheet', 'closes the sheet; nothing is queued', 'P2b'),
    c('cut.renderCancelAll', 'dock', 'Cancel all', 'the rail while this board renders', 'stops every render of this board', 'P2b'),
    c('cut.openSettings', 'dock', 'Open Settings', 'the Render missing beats sheet when nothing can render', 'opens Settings to install the engine', 'P2b'),
    c('cut.signIn', 'dock', 'Sign in to bloop', 'the Render missing beats sheet when nothing can render', 'opens Settings to sign in and render on bloop', 'P2b'),
    c('board.starter', 'board', 'Start from a starter', 'the empty board and the empty Spaces list', 'lays out a ready plan', 'P2b'),
    c('board.starterPick', 'board', 'Lay it out', 'each starter in Start from a starter', 'lays that starter out, cards wired and words written', 'P2b'),
    c('board.bringClips', 'board', 'Bring my clips', 'the empty board and the empty dock', 'puts your own videos and one song into the cut', 'P2b'),
    // ── P3: export and Pack ──
    c('cut.export', 'dock', 'Export', 'the rail and the export sheet', 'makes the cut into one video file on this PC', 'P3'),
    c('cut.preset', 'dock', 'Preset', 'the export sheet', 'picks the file\'s size and quality', 'P3'),
    c('cut.showFolder', 'dock', 'Show in folder', 'a finished export or pack', 'shows the file in its folder', 'P3'),
    c('cut.copyPath', 'dock', 'Copy path', 'a finished export', 'copies where the file is', 'P3'),
    c('cut.showOnBoard', 'dock', 'Show on board', 'a finished export', 'pans to the new video card', 'P3'),
    c('cut.poster', 'dock', 'Set as poster', 'a selected clip\'s details', 'picks the cover frame', 'P3'),
    c('cut.check', 'dock', 'Check your cut', 'the export sheet', 'lists what needs work', 'P3'),
    c('cut.showMe', 'dock', 'Show me', 'a line of Check your cut', 'jumps to that place in the cut', 'P3'),
    c('cut.pack', 'dock', 'Pack assets', 'the rail', 'puts every file this board made into one zip', 'P3'),
    c('cut.includePrompts', 'dock', 'Include prompts and seeds', 'the pack sheet', 'decides whether the prompts go too', 'P3'),
    c('cut.exportCancel', 'dock', 'Cancel', 'the export sheet while it exports or waits', 'stops the export; nothing is saved', 'P3'),
    c('cut.exportRetry', 'dock', 'Try again', 'the export or pack sheet after it stopped', 'starts it again with the same choices', 'P3'),
    c('cut.exportAgain', 'dock', 'Export again', 'the export sheet when the cut changed since', 'makes a new file from the cut as it is now', 'P3'),
    c('cut.removeAndExport', 'dock', 'Remove it and export again', 'the export sheet when one clip could not be read', 'takes that clip out of the cut and exports again', 'P3'),
    c('cut.download', 'dock', 'Download', 'a finished export', 'saves a copy of the file where you choose', 'P3'),
    c('cut.sheetClose', 'dock', 'Close', 'the export and pack sheets', 'closes the sheet; a running export keeps going', 'P3'),
    c('settings.videoTools', 'settings', 'Video tools', 'Settings', 'shows the ffmpeg the app uses', 'P3'),
    c('settings.checkAgain', 'settings', 'Check again', 'Settings › Video tools', 'looks for the video tools again', 'P3'),
    c('settings.chooseFfmpeg', 'settings', 'Choose ffmpeg.exe', 'Settings › Video tools', 'points the app at your own ffmpeg', 'P3'),
    // ── P4: the Director edits ──
    c('cut.snap', 'dock', 'Snap to beats', 'the open dock', 'lands trims and drops on the music\'s downbeats', 'P4'),
    c('cut.duck', 'dock', 'Duck under lines', 'under the Music level', 'sets how far music drops under spoken lines', 'P4'),
    c('cut.turnShow', 'dock', 'Show edits', 'the Director\'s turn strip', 'lists each edit the Director made', 'P4'),
    c('cut.undoTurn', 'dock', 'Undo turn', 'the Director\'s turn strip', 'takes back everything that turn changed', 'P4'),
    c('settings.editingStyle', 'settings', 'Editing style', 'Settings › Director', 'holds how you like to cut', 'P4'),
    // ── P6: outputs ──
    c('cut.shapes', 'dock', 'Shapes', 'the export sheet', 'makes 16:9, 9:16 or 1:1 files', 'P6'),
    c('cut.captions', 'dock', 'Captions', 'the export sheet', 'burns the script\'s lines into the picture', 'P6'),
    c('cut.gif', 'dock', 'Preview GIF', 'the export sheet', 'writes a 6 s GIF next to the file', 'P6'),
    // ── Full Katana ──
    c('cut.openKatana', 'dock', 'Open in Katana', 'the rail', 'opens the cut in the full editor', 'K1'),
]);

const BY_ID = new Map(CONTROLS.map((entry) => [entry.id, entry]));

export const controlById = (id) => BY_ID.get(id) ?? null;

/** The words on a control. An unknown id throws, so a typo in a view fails loudly instead of showing an id. */
export function controlLabel(id) {
    const entry = BY_ID.get(id);
    if (!entry) throw new Error(`Unknown Katana control "${id}".`);
    return entry.label;
}

/** The text a slot shows for each BoardCut state and reason. */
export const SLOT_TEXT = Object.freeze({
    never_rendered: 'not rendered',
    rendering: 'rendering',
    failed: 'render failed',
    card_deleted: 'card deleted',
    file_missing: 'file missing',
    unmeasured: 'not measured',
});

/**
 * The dock's other words (rail readout, loading, slot states). `{name}` placeholders are filled by copy().
 * Dock code reads COPY / copy(); add keys here, never strings in the dock.
 */
export const COPY = Object.freeze({
    title: 'Cut',
    loading: 'Loading the cut…',
    loadError: 'Could not load the cut. The board still works.',
    noClips: 'No clips yet. Render a beat\'s video card and it lands here.',
    notRendered: SLOT_TEXT.never_rendered,
    rendering: SLOT_TEXT.rendering,
    failed: SLOT_TEXT.failed,
    deleted: SLOT_TEXT.card_deleted,
    fileMissing: SLOT_TEXT.file_missing,
    notMeasured: SLOT_TEXT.unmeasured,
    beats: '{ready} of {n} beats',
    withGaps: '{total} with gaps',
    allGaps: '{n} beats, none rendered yet',
    noMusic: 'No music yet. Add an Audio card labelled music bed.',
    noVoice: 'No voice yet. Add an Audio card labelled voice.',
    // ── P2: editing, saving, preview ──
    allReady: 'All {n} beats are rendered.',
    someReady: '{ready} of {n} beats are rendered. Fill the cut to start editing.',
    saved: 'Saved',
    saving: 'Saving…',
    notSaved: 'Not saved, kept on this device',
    conflict: 'This cut changed in another window.',
    director: 'The Director changed the cut.',
    restore: 'Restore unsaved changes?',
    replaceOffer: 'A fresh draft in beat order is ready to replace this cut.',
    removed: 'Removed {title} from the cut',
    moved: 'Beat {beat} moved to position {to}',
    trimReset: 'Trim reset to fit the new take',
    slate: 'not rendered',
    unplayable: 'Could not play this clip',
    asExported: '{total} as exported',
    withGapsTotal: '{total} with gaps',
    draftFailed: 'Could not fill the cut. The board still works.',
    // ── P2b: first run (05 §2) ──
    allIn: 'All {n} beats are in',
    autoOff: 'You edited the cut. New clips now wait for you.',
    autoPlaced: 'Placed in beat order',
    addNewCount: '{label} · {n}',
    renderTitle: 'Render missing beats',
    renderKey: 'Render {n} missing beats',
    renderCards: 'Render {n} cards',
    renderLocal: '{n} cards on this PC · {time} · you can keep working',
    renderLocalUntimed: '{n} cards on this PC · time depends on your graphics card · you can keep working',
    renderCloud: '{n} cards · about {credits} credits · you have {balance} · renders on bloop',
    renderCloudUnknown: '{n} cards on bloop · the cost or your balance could not be read',
    renderShort: 'This needs about {credits} credits and you have {balance}. Nothing will be queued.',
    renderNothing: 'Every beat already has its video, or is on its way.',
    renderSkipped: 'Skipped',
    renderQueued: '{n} cards queued. They render one at a time; you can keep working.',
    renderFailed: 'Could not queue the renders. Nothing was queued.',
    renderCancelled: 'Stopped {n} renders.',
    bringCopying: 'Copying {n} files to your media folder · {done} of {n}',
    bringDone: 'Your clips are in the cut · {length}',
    bringDoneSong: 'Your clips are in the cut · {length} · with your song',
    bringNoClips: 'Drop video files (MP4 or WebM), and one song if you like.',
    bringFailed: 'Could not copy {name}: {reason}',
    bringNotEmpty: 'Bring my clips works on an empty cut. Add an Upload card for one more clip.',
    // ── P3: export and Pack (02-dock.md §5, 01-core.md §6, 05 §2.6) ──
    exportTitle: 'Export the cut',
    exportFree: 'Export runs on this PC. Free.',
    exportNoCaptions: 'No captions are burned in.',
    exportSkipped: 'Skipped, no video yet: {names}',
    exportNoSkips: 'Every beat is in.',
    exportSize: 'about {mb} MB',
    presetMaster: 'The copy to keep, in the plan\'s shape.',
    presetYoutube: '16:9, ready to upload to YouTube.',
    exportDraft: 'Fill the cut first: the export uses the cut, and it is empty.',
    exportNoClips: 'There is no clip to export yet.',
    exportTooLong: 'The cut is {length}. The limit is 10 minutes.',
    exportTooMany: 'The cut has {n} clips. The limit is 50.',
    exportHeld: 'This cut changed in another window. Choose a version first.',
    exportSaving: 'Saving the latest changes…',
    exportUnsaved: 'The latest changes are not saved yet.',
    exportStarting: 'Starting the export…',
    exportQueued: 'Waiting for another export to finish',
    exportRunning: 'Exporting',
    exportDone: 'Your cut is ready · {length} · {size}, saved to your media folder',
    exportStale: 'This export is from an older version of the cut.',
    exportFailedAt: 'The export stopped at {beat}. That clip could not be read.',
    exportFailed: 'The export stopped. Nothing was saved.',
    exportCancelled: 'Export cancelled. Nothing was saved.',
    exportToolsMissing: 'The video tools are missing. Reinstall Bloop Studio, or choose ffmpeg.exe in Settings.',
    exportRefused: 'The export could not start.',
    exportAnnounceDone: 'Export done. It is in your media folder and on the board.',
    checkReady: 'Ready',
    checkCount: '{n} to look at',
    posterSet: 'Poster set at {time}',
    posterNone: 'Select a clip first.',
    packNote: 'Every file this board made, its notes and a manifest, in one zip in your media folder.',
    packStarting: 'Starting the pack…',
    packRunning: 'Packing',
    packDone: 'Packed {files}',
    packFailed: 'The pack stopped. Nothing was saved.',
    copied: 'Path copied',
    revealFailed: 'Could not show the file. It may have been moved.',
});

/** COPY[key] with `{name}` filled from vars; an unknown key comes back as itself so a gap is visible. */
export function copy(key, vars = {}) {
    const text = COPY[key];
    if (text === undefined) return key;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** Empty-state copy (05 §2.3). Ghosts are static; every state is real text. */
export const EMPTY_TEXT = Object.freeze({
    dock: 'No clips yet. Render a beat\'s video card and it lands here.',
    board: 'Make a short film. Clips land here in order, timed to music.',
    ghostSlots: Object.freeze(['01 · Open', '02 · Turn', '03 · Close']),
    music: 'No music yet. Add an Audio card labelled music bed.',
    voice: 'No voice yet. Add an Audio card labelled voice.',
});
