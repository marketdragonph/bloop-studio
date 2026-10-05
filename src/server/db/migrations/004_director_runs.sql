-- The Director runs as a background job: one row per request, so a turn outlives the chat panel
-- and an app restart mid-turn is noticed (and offered as Continue) instead of silently lost.
CREATE TABLE director_runs (
    id          INTEGER PRIMARY KEY,
    space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    status      TEXT    NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'done', 'failed', 'stopped')),
    request     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at TEXT
) STRICT;

CREATE INDEX director_runs_space ON director_runs(space_id, id);

-- A log entry the person can pick up from with Continue (the step budget ran out, or the app closed).
ALTER TABLE director_log ADD COLUMN continuable INTEGER NOT NULL DEFAULT 0;
