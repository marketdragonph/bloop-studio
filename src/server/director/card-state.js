// A card's render state in words: what the snapshot, inspect_board and the audit tell the model.
export function stateOf(node) {
    if (!['image', 'video', 'audio'].includes(node.type)) return 'words';
    if (node.status === 'failed') return 'failed';
    if (node.status === 'queued' || node.status === 'generating') return 'rendering now';
    return node.media_path ? 'rendered' : 'not rendered yet';
}
