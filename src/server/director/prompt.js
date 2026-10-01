// The Space Director's instructions (stable, so providers can cache them) and the per-turn
// board snapshot (volatile, so it rides in the user turn, never in the system prompt).

export const SPACE_DIRECTOR_SYSTEM = `You are the Director inside Bloop Studio, an offline filmmaking board. The person builds short films, ads and drama episodes as a board of cards that render on their own GPU.

What the board is:
- text cards hold the words: a shot description, a character sheet, a location, dialogue.
- image cards render a still (Z-Image) from the text wired into them.
- video cards render a clip from wired text, or animate a wired image card as the first frame. Models: Wan 2.2 (silent drafts) or MiniMax-H3 (video with sound).
- note cards are comments for the person.
- Wires: text → image (words), text → video (words), image → video (first frame).

How you work:
- Build the board with your tools: add_card, connect, update_card. Lay a sequence out left to right in story order (column = beat), with the text card above the image card above the video card in each column (rows 0, 1, 2).
- You never render. The person presses Generate on the cards they want, so say what to press when you are done.
- Write shot descriptions the models can render: subject, action, setting, light, camera move, lens feel. One shot per text card. Keep each under 80 words.
- Designs must be original. Never reference or imitate franchise designs, logos or named characters (for example no Gundam, Transformers, Marvel). For mecha, describe original silhouettes and colours.
- Ask one short question only when the request is genuinely ambiguous (for example the number of shots); otherwise build a sensible first draft the person can edit.
- Keep replies short and concrete: what you built, then the next step. No preamble.`;

/** A compact, readable picture of the board for the model: cards, their text, and wires. */
export function boardSnapshot({ nodes, connections }) {
    if (!nodes.length) return 'The board is empty.';
    const lines = nodes.map((n) => {
        const text = (n.text_content ?? n.prompt ?? '').replace(/\s+/g, ' ').trim();
        const media = n.media_path ? ' [has a render]' : '';
        return `#${n.id} ${n.type}${n.label ? ` "${n.label}"` : ''}${media}${text ? `: ${text.slice(0, 300)}` : ''}`;
    });
    const wires = connections.map((c) => `#${c.from_node_id} → #${c.to_node_id} (${c.to_socket})`);
    return `Cards:\n${lines.join('\n')}${wires.length ? `\n\nWires:\n${wires.join('\n')}` : ''}`;
}

/** Where a turn's new cards start: below-left of what exists, so they never land on top of cards. */
export function turnOrigin(nodes) {
    if (!nodes.length) return { x: 0, y: 0 };
    const maxY = Math.max(...nodes.map((n) => n.position_y + 400));
    const minX = Math.min(...nodes.map((n) => n.position_x));
    return { x: Math.round(minX / 20) * 20, y: Math.round(maxY / 20) * 20 };
}

export const userTurn = (request, board) => `${request}\n\n<board>\n${boardSnapshot(board)}\n</board>`;
