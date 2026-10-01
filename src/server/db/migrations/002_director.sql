-- The Director: one conversation per space.
-- director_threads holds the provider-native message history exactly as the API needs it
-- back (append-only: Claude's thinking blocks are only valid in the history that produced them).
-- director_log is what the chat panel shows: plain text plus the board actions taken.
CREATE TABLE director_threads (
    space_id   INTEGER PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
    provider   TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    messages   TEXT    NOT NULL DEFAULT '[]',
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE director_log (
    id         INTEGER PRIMARY KEY,
    space_id   INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'notice')),
    text       TEXT    NOT NULL DEFAULT '',
    actions    TEXT    NOT NULL DEFAULT '[]',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX director_log_space ON director_log(space_id, id);
