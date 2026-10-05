// THE CUT AND KATANA, the Director's guide to the Cut dock and Full Katana (05-irresistible.md §4.2).
// Rendered from the controls registry, ONLY for shipped phases, in a fixed order, so it is byte-stable
// (the provider's prompt cache holds) and can never describe a control that is not in the app.
// Renaming a button in src/shared/katana-controls.js renames it here too. Kept under 3,000 characters
// (tests/katana-guide.test.js): P6 tightened the earlier lines' wording to make room, nothing was dropped.
import { controlLabel as l, KEYS } from '../../../shared/katana-controls.js';
import { SHIPPED } from '../../../shared/katana-phases.js';

const HEADER = 'THE CUT AND KATANA. Explain these only WHEN ASKED. Only what is listed here exists.';

/** One entry per guide line, in the order the guide reads. Lines are functions so labels resolve from the registry. */
const LINES = [
    ['P1', () => `The ${l('cut.dock')} is the dock at the bottom of a Space. Folded it is one line (beats, length, saved); the fold key opens it. Open: lanes ${l('cut.lane.video')}, ${l('cut.lane.voice')}, ${l('cut.lane.music')}.`],
    ['P1', () => `Clips sit in beat order. A hatched slot is a beat with no video yet; ${l('cut.goToCard')} takes you to its card. Not measured = its asked length.`],
    ['P1', () => `With no clips yet, ${l('cut.askDirector')} opens this panel.`],
    ['P2', () => `The ${l('cut.preview')} plays the cut (${KEYS.play} or ${l('cut.play')}). Gaps never go into the export; ${l('cut.asExported')} hides them.`],
    ['P2', () => `${l('cut.fill')} puts every rendered beat in, in order.`],
    ['P2', () => `Click a clip (or Tab, arrows) to select it; drag or ${KEYS.move} moves it. Orange handles trim; ${KEYS.inPoint} ${KEYS.outPoint} set in/out at the playhead; ${KEYS.nudge} nudges 0.1 s. On touch: ${l('cut.moveLeft')} / ${l('cut.moveRight')} in its details.`],
    ['P2', () => `The chip between clips switches cut and dissolve (${KEYS.join}). ${KEYS.mute} mutes a clip's own sound. ${KEYS.remove} takes a clip out of the cut, never off the board; ${l('cut.undo')} shows for 8 s.`],
    ['P2', () => `${KEYS.undo} / ${KEYS.redo} undo/redo in the dock. ${l('cut.fit')} fits the cut to the lane. The ${l('cut.level')} key on Music or Voice sets it.`],
    ['P2', () => `The cut saves by itself. Changed in another window: ${l('cut.useNewer')} or ${l('cut.keepMine')}. A newer take: ${l('cut.useNewTake')}.`],
    ['P2b', () => `On a planned board the cut fills itself as clips land until you edit it; then new clips wait for ${l('cut.addNew')}.`],
    ['P2b', () => `${l('cut.renderMissing')} queues the cards the plan needs, one at a time, after a sheet with count and cost; nothing renders until you press it; ${l('cut.renderCancelAll')} stops them.`],
    ['P2b', () => `On an empty board, ${l('board.starter')} lays out a ready plan. ${l('board.bringClips')} (or dropping files) puts your videos and one song into the cut.`],
    ['P3', () => `${l('cut.export')} opens a sheet (what goes in, length, size, ${l('cut.preset')}); press ${l('cut.export')} there. Up to 10 minutes, on this PC, free. The file lands in the media folder and on the board (${l('cut.showFolder')}, ${l('cut.copyPath')}, ${l('cut.showOnBoard')}).`],
    ['P3', () => `${l('cut.poster')} (a clip's details) picks the cover frame. ${l('cut.check')} lists what needs work; ${l('cut.showMe')} jumps there.`],
    ['P3', () => `${l('cut.pack')} zips every file this board made into the media folder; ${l('cut.includePrompts')} adds the prompts.`],
    ['P3', () => `Video tools missing: Settings › ${l('settings.videoTools')}, then ${l('settings.checkAgain')} or ${l('settings.chooseFfmpeg')}.`],
    ['P4', () => `${l('cut.snap')}, over the lane names, lands a dragged trim on a downbeat; blue ticks are estimated beats. ${l('cut.duck')}, in the Music ${l('cut.level')}, sets how far music drops under lines.`],
    ['P4', () => `After I edit, a blue strip shows it: ${l('cut.turnShow')} lists each edit, ${l('cut.undoTurn')} takes it all back.`],
    ['P4', () => `Settings › Director › ${l('settings.editingStyle')} holds how you like to cut.`],
    ['P6', () => `${l('cut.shape')} (under the preview) shows 16:9, 9:16 or 1:1 as exported. ${l('cut.crop')} shows a selected clip's ${l('cut.cropBox')}: drag, pinch or arrow keys; Home centres it.`],
    ['P6', () => `The export sheet has TikTok, Reels and Shorts presets; ${l('cut.shapes')}: one file per shape; ${l('cut.softBars')} avoids soft crops; ${l('cut.captions')} burns in the script's lines (.srt beside); ${l('cut.gif')}: 6 s. Say "ready for TikTok" and I set these up.`],
    ['K1', () => `${l('cut.openKatana')} opens the cut in the full editor. Changes there do not come back to the Space. A blank project there imports your own files. Katana needs a wide window.`],
    ['P4', () => 'You can also just tell me: "tighter", "cut on the beat", "music down 4 dB", "undo that". I edit; I never render and I never export.'],
];

/** The guide block for the shipped phases; '' when nothing of the Cut has shipped. */
export function guideKatana({ shipped = SHIPPED } = {}) {
    const lines = LINES.filter(([phase]) => shipped.includes(phase)).map(([, line]) => `- ${line()}`);
    return lines.length ? `\n\n${HEADER}\n\n${lines.join('\n')}\n` : '';
}
