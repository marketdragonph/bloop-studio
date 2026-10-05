-- The Director runs as a background job: one row per request, so a turn outlives the chat panel
-- and an app restart mid-turn is noticed (and resumed) instead of silently lost.
CREATE TABLE director_runs (
    id          INTEGER PRIMARY KEY,
    space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    status      TEXT    NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'done', 'failed', 'stopped')),
    request     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at TEXT
) STRICT;

CREATE INDEX director_runs_space ON director_runs(space_id, id);

-- Unused since 2026-10-05 (the Director continues by itself); kept, as installed apps already have it.
ALTER TABLE director_log ADD COLUMN continuable INTEGER NOT NULL DEFAULT 0;
