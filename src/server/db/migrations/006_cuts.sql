-- Mini Katana: one cut per Space (bloop's spaces-mini-timeline plan, ported) and its export/pack jobs.
-- Canvas saves never touch space_cuts; the cut has its own revision and a 409 on a stale save.
CREATE TABLE space_cuts (
    id             INTEGER PRIMARY KEY,
    space_id       INTEGER NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
    items          TEXT    NOT NULL DEFAULT '[]', -- array order = cut order
    sound          TEXT,   -- {music:{node_id,take_id,media_path,gain_db,fade_out_ms,duck?}, voice:{...,start_ms}}
    settings       TEXT    NOT NULL DEFAULT '{"resolution":1080,"fps":30}', -- + aspect from the plan
    previous_items TEXT,   -- one-step "Undo draft"
    revision       INTEGER NOT NULL DEFAULT 0,
    auto           INTEGER NOT NULL DEFAULT 1 CHECK (auto IN (0, 1)), -- live cut: fills itself until the person edits (P2b)
    updated_by     TEXT    NOT NULL DEFAULT 'person' CHECK (updated_by IN ('person', 'director')),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE cut_exports (
    id                  INTEGER PRIMARY KEY,
    space_id            INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    kind                TEXT    NOT NULL CHECK (kind IN ('export', 'pack')),
    cut_revision        INTEGER,
    status              TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    progress            REAL    NOT NULL DEFAULT 0,
    step                TEXT,
    error               TEXT,
    error_beat          TEXT,     -- the beat tag a failed export stopped at
    media_path          TEXT,     -- the finished mp4 or zip, relative to the media folder
    bytes               INTEGER,
    node_id             INTEGER REFERENCES space_nodes(id) ON DELETE SET NULL, -- result card
    cancel_requested_at TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at         TEXT
) STRICT;
CREATE INDEX cut_exports_space ON cut_exports(space_id, id);

-- Measured by ffprobe when a take lands (MeasureTake), never the asked length. NULL = not measured.
ALTER TABLE takes ADD COLUMN duration_ms INTEGER;
