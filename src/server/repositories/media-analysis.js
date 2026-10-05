// The analysis cache (009_cut_director.sql): one row per media file, valid while its size, mtime and the
// analyzer version match. AnalyzeMedia writes it; inspect_cut, the cut critic and GET /spaces/:id/cut read it.
const json = (text, fallback) => {
    try {
        return text == null ? fallback : JSON.parse(text);
    } catch {
        return fallback;
    }
};

const hydrate = (row) => row && { ...row, data: json(row.data, {}) };

export class MediaAnalysisRepository {
    constructor(db) {
        this.db = db;
    }

    find(mediaPath) {
        return hydrate(this.db.prepare('SELECT * FROM media_analysis WHERE media_path = ?').get(mediaPath)) ?? null;
    }

    /** The row when it still describes the file as it is now (same size, mtime and analyzer), else null. */
    fresh(mediaPath, { size, mtimeMs, version }) {
        const row = this.find(mediaPath);
        if (!row || row.size !== size || row.mtime_ms !== Math.round(mtimeMs) || row.version !== version) return null;
        return row;
    }

    /** Done rows for many paths at once: Map(path → data). Stale rows are left out by the caller's key check. */
    many(paths) {
        const out = new Map();
        const unique = [...new Set(paths.filter(Boolean))];
        if (!unique.length) return out;
        const rows = this.db.prepare(`SELECT * FROM media_analysis WHERE status = 'done' AND media_path IN (${unique.map(() => '?').join(',')})`).all(...unique);
        for (const row of rows) out.set(row.media_path, hydrate(row));
        return out;
    }

    save(mediaPath, { size, mtimeMs, version, status, data = {}, error = null }) {
        this.db.prepare(`
            INSERT INTO media_analysis (media_path, size, mtime_ms, version, status, data, error) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(media_path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, version = excluded.version,
                status = excluded.status, data = excluded.data, error = excluded.error, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        `).run(mediaPath, size, Math.round(mtimeMs), version, status, JSON.stringify(data), error);
        return this.find(mediaPath);
    }
}
