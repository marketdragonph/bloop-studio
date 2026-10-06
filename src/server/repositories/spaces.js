// Spaces, their cards and wires. Every write validates against src/shared/node-types.js.
import { now, transaction } from '../db/database.js';
import { checkConnection, isNodeType, MAX_NODES_PER_SPACE, DEFAULT_WIDTH } from '../../shared/node-types.js';

const NODE_FIELDS = ['label', 'position_x', 'position_y', 'width', 'height', 'prompt', 'text_content', 'settings'];

const parseJson = (text, fallback) => {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
};

const hydrateNode = (row) => row && { ...row, settings: parseJson(row.settings, {}) };
const hydrateSpace = (row) => row && { ...row, canvas_state: parseJson(row.canvas_state, { zoom: 1, panX: 0, panY: 0 }) };

export class ValidationError extends Error {}

export class SpacesRepository {
    constructor(db) {
        this.db = db;
    }

    // ── Spaces ──

    /**
     * Every space, newest first, with its card count and a cover: the image card named "thumbnail", else "poster",
     * else the newest finished image on the board.
     */
    list() {
        return this.db.prepare(`
            SELECT s.*,
                (SELECT COUNT(*) FROM space_nodes n WHERE n.space_id = s.id) AS node_count,
                (SELECT c.media_path FROM space_nodes c
                    WHERE c.space_id = s.id AND c.media_path IS NOT NULL AND c.media_mime LIKE 'image/%'
                    ORDER BY CASE WHEN c.label LIKE '%thumbnail%' THEN 0 WHEN c.label LIKE '%poster%' THEN 1 ELSE 2 END,
                        c.updated_at DESC, c.id DESC
                    LIMIT 1) AS cover_path
            FROM spaces s ORDER BY s.updated_at DESC
        `).all().map(hydrateSpace);
    }

    find(id) {
        return hydrateSpace(this.db.prepare('SELECT * FROM spaces WHERE id = ?').get(id));
    }

    create({ name, description = null }) {
        const clean = String(name ?? '').trim();
        if (!clean) throw new ValidationError('Give the space a name.');
        if (clean.length > 120) throw new ValidationError('Keep the name under 120 characters.');
        const { lastInsertRowid } = this.db
            .prepare('INSERT INTO spaces (name, description) VALUES (?, ?)')
            .run(clean, description?.trim() || null);
        return this.find(Number(lastInsertRowid));
    }

    rename(id, name) {
        const clean = String(name ?? '').trim();
        if (!clean) throw new ValidationError('Give the space a name.');
        this.db.prepare('UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?').run(clean, now(), id);
    }

    delete(id) {
        this.db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
    }

    /** The whole board in one read: the editor's initial state. */
    board(id) {
        const space = this.find(id);
        if (!space) return null;
        const nodes = this.db.prepare('SELECT * FROM space_nodes WHERE space_id = ? ORDER BY id').all(id).map(hydrateNode);
        const connections = this.db.prepare('SELECT * FROM space_connections WHERE space_id = ? ORDER BY id').all(id);
        return { space, nodes, connections };
    }

    /**
     * Saves the view and the geometry of cards that moved, in one transaction. Only cards
     * belonging to this space are touched, whatever ids the client sends.
     */
    saveCanvas(spaceId, { canvas_state: view, nodes = [] }) {
        const clamp = (value, lo, hi, fallback) => (Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback);
        const state = { zoom: clamp(view?.zoom, 0.1, 3, 1), panX: clamp(view?.panX, -1e6, 1e6, 0), panY: clamp(view?.panY, -1e6, 1e6, 0) };
        const move = this.db.prepare(`
            UPDATE space_nodes SET position_x = ?, position_y = ?, width = ?, height = ?, updated_at = ?
            WHERE id = ? AND space_id = ?
        `);
        transaction(this.db, () => {
            this.db.prepare('UPDATE spaces SET canvas_state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), now(), spaceId);
            for (const n of nodes) {
                move.run(clamp(n.position_x, -1e6, 1e6, 0), clamp(n.position_y, -1e6, 1e6, 0), n.width ?? null, n.height ?? null, now(), n.id, spaceId);
            }
        });
    }

    // ── Cards ──

    spaceOfNode(nodeId) {
        return this.db.prepare('SELECT space_id FROM space_nodes WHERE id = ?').get(nodeId)?.space_id ?? null;
    }

    findNode(spaceId, nodeId) {
        return hydrateNode(this.db.prepare('SELECT * FROM space_nodes WHERE id = ? AND space_id = ?').get(nodeId, spaceId));
    }

    createNode(spaceId, { type, position_x = 0, position_y = 0, text_content = null, label = null }) {
        if (!isNodeType(type)) throw new ValidationError(`Unknown card type "${type}".`);
        const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM space_nodes WHERE space_id = ?').get(spaceId);
        if (count >= MAX_NODES_PER_SPACE) throw new ValidationError(`A space holds up to ${MAX_NODES_PER_SPACE} cards.`);

        const { lastInsertRowid } = this.db.prepare(`
            INSERT INTO space_nodes (space_id, type, label, position_x, position_y, width, text_content)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(spaceId, type, label, Number(position_x) || 0, Number(position_y) || 0, DEFAULT_WIDTH, text_content);
        this.#touch(spaceId);
        return this.findNode(spaceId, Number(lastInsertRowid));
    }

    updateNode(spaceId, nodeId, changes) {
        const node = this.findNode(spaceId, nodeId);
        if (!node) return null;
        const fields = NODE_FIELDS.filter((f) => f in changes);
        if (fields.length) {
            const values = fields.map((f) => (f === 'settings' ? JSON.stringify({ ...node.settings, ...changes.settings }) : changes[f]));
            this.db.prepare(`UPDATE space_nodes SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND space_id = ?`)
                .run(...values, now(), nodeId, spaceId);
            this.#touch(spaceId);
        }
        return this.findNode(spaceId, nodeId);
    }

    /** Status/output changes come from the job pipeline, not the client. */
    setNodeResult(nodeId, { status, error = null, media_path, media_mime }) {
        const sets = ['status = ?', 'error = ?', 'updated_at = ?'];
        const values = [status, error, now()];
        if (media_path !== undefined) {
            sets.push('media_path = ?', 'media_mime = ?');
            values.push(media_path, media_mime);
        }
        this.db.prepare(`UPDATE space_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values, nodeId);
    }

    /**
     * Deletes a card. Returns its takes as they were (with the measured length), so an undo can put them back: the
     * Cut's items point at a take, and a clip that came back without one would lose its length.
     */
    deleteNode(spaceId, nodeId) {
        const takes = this.db.prepare(`SELECT t.id, t.media_path, t.media_mime, t.preset, t.seed, t.params, t.created_at, t.duration_ms
            FROM takes t JOIN space_nodes n ON n.id = t.node_id WHERE t.node_id = ? AND n.space_id = ? ORDER BY t.id`).all(nodeId, spaceId);
        this.db.prepare('DELETE FROM space_nodes WHERE id = ? AND space_id = ?').run(nodeId, spaceId);
        this.#touch(spaceId);
        return takes.map((take) => ({ ...take }));
    }

    /** Re-inserts a deleted card with its id, wires and takes (undo of delete). A take keeps its id when it is free. */
    restoreNode(spaceId, node, connections = [], takes = []) {
        transaction(this.db, () => {
            this.db.prepare(`
                INSERT INTO space_nodes (id, space_id, type, label, position_x, position_y, width, height, prompt, text_content, media_path, media_mime, settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(node.id, spaceId, node.type, node.label ?? null, node.position_x, node.position_y, node.width ?? null, node.height ?? null,
                node.prompt ?? null, node.text_content ?? null, node.media_path ?? null, node.media_mime ?? null, JSON.stringify(node.settings ?? {}));
            for (const c of connections) this.#insertConnection(spaceId, c.from_node_id, c.to_node_id, c.to_socket, c.id);
            for (const t of Array.isArray(takes) ? takes : []) this.#restoreTake(node.id, t);
        });
        return this.findNode(spaceId, node.id);
    }

    #restoreTake(nodeId, t) {
        if (typeof t?.media_path !== 'string' || typeof t.media_mime !== 'string' || typeof t.preset !== 'string') return;
        const free = Number.isInteger(t.id) && !this.db.prepare('SELECT 1 FROM takes WHERE id = ?').get(t.id);
        const duration = Number.isInteger(t.duration_ms) && t.duration_ms > 0 ? t.duration_ms : null;
        this.db.prepare(`INSERT INTO takes (id, node_id, media_path, media_mime, preset, seed, params, created_at, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?)`)
            .run(free ? t.id : null, nodeId, t.media_path, t.media_mime, t.preset, Number.isInteger(t.seed) ? t.seed : null,
                typeof t.params === 'string' ? t.params : JSON.stringify(t.params ?? {}), typeof t.created_at === 'string' ? t.created_at : null, duration);
    }

    // ── Wires ──

    upstreamOf(spaceId, nodeId) {
        return this.db.prepare(`
            SELECT c.to_socket, n.* FROM space_connections c
            JOIN space_nodes n ON n.id = c.from_node_id
            WHERE c.to_node_id = ? AND c.space_id = ? ORDER BY c.id
        `).all(nodeId, spaceId).map(hydrateNode);
    }

    connect(spaceId, fromId, toId, socketKey = null) {
        const from = this.findNode(spaceId, fromId);
        const to = this.findNode(spaceId, toId);
        const existing = this.db.prepare('SELECT * FROM space_connections WHERE space_id = ?').all(spaceId);
        const verdict = checkConnection({ from, to, existing, socketKey });
        if (!verdict.ok) throw new ValidationError(verdict.reason);
        return this.#insertConnection(spaceId, fromId, toId, verdict.socket);
    }

    disconnect(spaceId, connectionId) {
        this.db.prepare('DELETE FROM space_connections WHERE id = ? AND space_id = ?').run(connectionId, spaceId);
    }

    #insertConnection(spaceId, fromId, toId, socket, id = null) {
        const { lastInsertRowid } = this.db.prepare(`
            INSERT INTO space_connections (id, space_id, from_node_id, to_node_id, to_socket) VALUES (?, ?, ?, ?, ?)
        `).run(id, spaceId, fromId, toId, socket);
        return this.db.prepare('SELECT * FROM space_connections WHERE id = ?').get(Number(lastInsertRowid));
    }

    #touch(spaceId) {
        this.db.prepare('UPDATE spaces SET updated_at = ? WHERE id = ?').run(now(), spaceId);
    }
}
