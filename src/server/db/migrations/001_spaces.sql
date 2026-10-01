-- Spaces: boards of cards wired together. Times are ISO-8601 text; JSON columns are text.
CREATE TABLE spaces (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    description  TEXT,
    canvas_state TEXT    NOT NULL DEFAULT '{"zoom":1,"panX":0,"panY":0}',
    thumbnail    TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE space_nodes (
    id           INTEGER PRIMARY KEY,
    space_id     INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    type         TEXT    NOT NULL,
    label        TEXT,
    position_x   REAL    NOT NULL DEFAULT 0,
    position_y   REAL    NOT NULL DEFAULT 0,
    width        REAL,
    height       REAL,
    prompt       TEXT,
    text_content TEXT,
    -- The card's current output: a file under the media folder (relative path).
    media_path   TEXT,
    media_mime   TEXT,
    -- Preset choice, seed lock, size, duration and other per-card knobs.
    settings     TEXT    NOT NULL DEFAULT '{}',
    status       TEXT    NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'queued', 'generating', 'done', 'failed')),
    error        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX space_nodes_space ON space_nodes(space_id);

CREATE TABLE space_connections (
    id            INTEGER PRIMARY KEY,
    space_id      INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    from_node_id  INTEGER NOT NULL REFERENCES space_nodes(id) ON DELETE CASCADE,
    to_node_id    INTEGER NOT NULL REFERENCES space_nodes(id) ON DELETE CASCADE,
    to_socket     TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (from_node_id, to_node_id)
) STRICT;

CREATE INDEX space_connections_space ON space_connections(space_id);

-- Every render a card has made (a "take"), so a re-run never destroys the last good one.
CREATE TABLE takes (
    id           INTEGER PRIMARY KEY,
    node_id      INTEGER NOT NULL REFERENCES space_nodes(id) ON DELETE CASCADE,
    media_path   TEXT    NOT NULL,
    media_mime   TEXT    NOT NULL,
    preset       TEXT    NOT NULL,
    seed         INTEGER,
    params       TEXT    NOT NULL DEFAULT '{}',
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX takes_node ON takes(node_id);

-- The single local GPU queue. One job runs at a time.
CREATE TABLE jobs (
    id              INTEGER PRIMARY KEY,
    node_id         INTEGER REFERENCES space_nodes(id) ON DELETE SET NULL,
    preset          TEXT    NOT NULL,
    inputs          TEXT    NOT NULL DEFAULT '{}',
    status          TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
    comfy_prompt_id TEXT,
    progress        REAL    NOT NULL DEFAULT 0,
    progress_label  TEXT,
    error           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at      TEXT,
    finished_at     TEXT
) STRICT;

CREATE INDEX jobs_status ON jobs(status, id);
