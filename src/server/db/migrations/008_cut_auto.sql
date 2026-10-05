-- Mini Katana P2b, the live cut (05-irresistible.md §2.1): clips the app places by itself while the person has not
-- edited are saved by 'auto', so the dock never mistakes them for a change in another window or by the Director.
-- SQLite cannot widen a CHECK in place: the table is rebuilt with the same columns, in the same order.
CREATE TABLE space_cuts_next (
    id             INTEGER PRIMARY KEY,
    space_id       INTEGER NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
    items          TEXT    NOT NULL DEFAULT '[]',
    sound          TEXT,
    settings       TEXT    NOT NULL DEFAULT '{"resolution":1080,"fps":30}',
    previous_items TEXT,
    revision       INTEGER NOT NULL DEFAULT 0,
    auto           INTEGER NOT NULL DEFAULT 1 CHECK (auto IN (0, 1)),
    updated_by     TEXT    NOT NULL DEFAULT 'person' CHECK (updated_by IN ('person', 'director', 'auto')),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO space_cuts_next (id, space_id, items, sound, settings, previous_items, revision, auto, updated_by, created_at, updated_at)
    SELECT id, space_id, items, sound, settings, previous_items, revision, auto, updated_by, created_at, updated_at FROM space_cuts;
DROP TABLE space_cuts;
ALTER TABLE space_cuts_next RENAME TO space_cuts;
