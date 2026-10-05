-- Mini Katana P4, the Director edits the Cut (docs/plans/katana/03-director.md §3, §5; planned as 007, renumbered
-- because 007 and 008 shipped first).
--
-- media_analysis: what AnalyzeMedia measured in one file (silence, speech spans, still frames, scene changes,
-- loudness, music beats, waveform bars), keyed by the file as it was: path, size, mtime and the analyzer version.
-- A changed file or a new analyzer measures again. `data` is JSON in milliseconds.
CREATE TABLE media_analysis (
    id         INTEGER PRIMARY KEY,
    media_path TEXT    NOT NULL UNIQUE, -- relative to the media folder
    size       INTEGER NOT NULL,
    mtime_ms   INTEGER NOT NULL,
    version    INTEGER NOT NULL,
    status     TEXT    NOT NULL CHECK (status IN ('done', 'failed')),
    data       TEXT    NOT NULL DEFAULT '{}',
    error      TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- cut_turns: one row per Director turn that changed the cut, written before the turn's first cut write.
-- `before` = {items, sound, settings} as they were; the one Undo turn puts them back while the cut's revision is
-- still `after_rev`. `reasons` is the why ledger (05 §3.2), `rows` what the turn strip lists (05 §3.1).
CREATE TABLE cut_turns (
    id               INTEGER PRIMARY KEY,
    space_id         INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    before           TEXT    NOT NULL,
    before_revision  INTEGER NOT NULL,
    before_total_ms  INTEGER NOT NULL DEFAULT 0,
    after_rev        INTEGER,
    after_total_ms   INTEGER,
    edits            INTEGER NOT NULL DEFAULT 0,
    changed          TEXT    NOT NULL DEFAULT '[]', -- node ids the turn changed
    rows             TEXT    NOT NULL DEFAULT '[]', -- [{kind, beat_tag, node_id, item_id, text, at_ms}]
    ops_summary      TEXT    NOT NULL DEFAULT '[]', -- sound rows ("Music: ducked -10 dB under 3 lines")
    reasons          TEXT    NOT NULL DEFAULT '[]', -- [{beat_tag, item_id, op, why, revision}]
    undone_at        TEXT,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX cut_turns_space ON cut_turns(space_id, id);
