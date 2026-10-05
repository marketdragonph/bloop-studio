// THE CUT AND KATANA, the Director's guide to the Cut dock and Full Katana (05-irresistible.md §4.2).
// Rendered from the controls registry, ONLY for shipped phases, in a fixed order, so it is byte-stable
// (the provider's prompt cache holds) and can never describe a control that is not in the app.
// Renaming a button in src/shared/katana-controls.js renames it here too.
import { controlLabel as l, KEYS } from '../../../shared/katana-controls.js';
import { SHIPPED } from '../../../shared/katana-phases.js';

const HEADER = 'THE CUT AND KATANA. Explain these only WHEN ASKED. Only what is listed here exists.';

/** One entry per guide line, in the order the guide reads. Lines are functions so labels resolve from the registry. */
const LINES = [
    ['P1', () => `The ${l('cut.dock')} is the dock at the bottom of a Space. Folded, it is one line: beats, length, saved or not; the fold key opens it. Open, it has three lanes: ${l('cut.lane.video')}, ${l('cut.lane.voice')}, ${l('cut.lane.music')}.`],
    ['P1', () => `Clips sit in beat order. A hatched slot is a beat with no video yet; ${l('cut.goToCard')} takes you to that card. A clip marked not measured shows its asked length.`],
    ['P1', () => `With no clips yet, ${l('cut.askDirector')} opens this panel.`],
    ['P2', () => `The ${l('cut.preview')} on the left plays the cut (${KEYS.play} or ${l('cut.play')}). Gaps never go into the export; ${l('cut.asExported')} plays without them.`],
    ['P2', () => `${l('cut.fill')} puts every rendered beat in, in order.`],
    ['P2', () => `Click a clip, or Tab and the arrow keys, to select it. Drag it or press ${KEYS.move} to move it. Drag its orange handles to trim; ${KEYS.inPoint} and ${KEYS.outPoint} set in and out at the playhead; ${KEYS.nudge} nudges 0.1 s. On touch, its details hold ${l('cut.moveLeft')} and ${l('cut.moveRight')}.`],
    ['P2', () => `The chip between two clips switches cut and dissolve (or ${KEYS.join}). ${KEYS.mute} turns a clip's own sound off. ${KEYS.remove} takes a clip out of the cut, never off the board; ${l('cut.undo')} shows for 8 s.`],
    ['P2', () => `${KEYS.undo} and ${KEYS.redo} undo and redo inside the dock. ${l('cut.fit')} fits the cut to the lane.`],
    ['P2', () => `The ${l('cut.level')} key on the Music or Voice lane sets it.`],
    ['P2', () => `The cut saves by itself. If it changed in another window, choose ${l('cut.useNewer')} or ${l('cut.keepMine')}. On a clip with a newer take, ${l('cut.useNewTake')} swaps it in.`],
    ['P2b', () => `On a planned board the cut fills itself as clips land, until you edit it; then new clips wait for ${l('cut.addNew')}.`],
    ['P2b', () => `${l('cut.renderMissing')} queues every card the plan still needs, one at a time, after a sheet with the count (and bloop credits). Nothing renders until you press it; ${l('cut.renderCancelAll')} stops them.`],
    ['P2b', () => `On an empty board, ${l('board.starter')} lays out a ready plan. ${l('board.bringClips')}, or dropping files, puts your own videos and one song into the cut, in drop order.`],
    ['P3', () => `${l('cut.export')} opens a sheet (what goes in and is skipped, length, size, ${l('cut.preset')}); press ${l('cut.export')} there. Up to 10 minutes at 1080p, on this PC, free. The file goes to the media folder and onto the board as a video card; ${l('cut.showFolder')}, ${l('cut.copyPath')} and ${l('cut.showOnBoard')} find it.`],
    ['P3', () => `${l('cut.poster')}, in a selected clip's details, picks the cover frame.`],
    ['P3', () => `${l('cut.check')} lists what needs work; ${l('cut.showMe')} jumps to it.`],
    ['P3', () => `${l('cut.pack')} puts every file this board made into one zip in the media folder; ${l('cut.includePrompts')} adds the prompts.`],
    ['P3', () => `If the video tools are missing: Settings › ${l('settings.videoTools')}, then ${l('settings.checkAgain')} or ${l('settings.chooseFfmpeg')}.`],
    ['P4', () => `${l('cut.snap')}, over the lane names, lands a dragged trim on the nearest downbeat; blue ruler ticks are estimated beats.`],
    ['P4', () => `${l('cut.duck')}, in the Music ${l('cut.level')}, sets how far music drops under spoken lines.`],
    ['P4', () => `After I edit, a blue strip shows what I changed: ${l('cut.turnShow')} lists each edit, ${l('cut.undoTurn')} takes it all back. ${l('cut.check')} is on the rail too.`],
    ['P4', () => `Settings › Director › ${l('settings.editingStyle')} holds how you like to cut.`],
    ['P6', () => `${l('cut.shapes')} in the export sheet makes 16:9, 9:16 or 1:1 files, one per shape, with TikTok, Reels and Shorts presets. In 9:16 or 1:1 the preview shows a crop box per clip; drag it or use the arrow keys.`],
    ['P6', () => `${l('cut.captions')} burns the script's lines into the picture; an .srt file is written next to every export.`],
    ['P6', () => `${l('cut.gif')} writes a 6 s GIF next to the file.`],
    ['K1', () => `${l('cut.openKatana')} opens the cut in the full editor. Changes there do not come back to the Space. A blank project there imports your own files. Katana needs a wide window.`],
    ['P4', () => 'You can also just tell me: "tighter", "cut on the beat", "music down 4 dB", "undo that". I edit; I never render and I never export.'],
];

/** The guide block for the shipped phases; '' when nothing of the Cut has shipped. */
export function guideKatana({ shipped = SHIPPED } = {}) {
    const lines = LINES.filter(([phase]) => shipped.includes(phase)).map(([, line]) => `- ${line()}`);
    return lines.length ? `\n\n${HEADER}\n\n${lines.join('\n')}\n` : '';
}
