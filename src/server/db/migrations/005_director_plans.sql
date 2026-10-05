-- The Director's plan, ported from bloop's space_agent_plans / space_build_stages / space_agent_plan_beats.
-- A plan row per planning pass (latest by id is the board's plan; its existence is the never-re-ask rule),
-- stage rows for the rail (cast, world) and the build intent (beats), and one row per beat lane.
CREATE TABLE director_plans (
    id              INTEGER PRIMARY KEY,
    space_id        INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    approach        TEXT,
    questions       TEXT    NOT NULL DEFAULT '[]',
    assumptions     TEXT    NOT NULL DEFAULT '[]',
    aspect          TEXT,
    runtime_seconds INTEGER,
    plates          TEXT    NOT NULL DEFAULT '{}', -- tag -> { look, sheet, picture, voice } node ids, as LAID
    origin_x        REAL,
    origin_y        REAL,
    dispatched_at   TEXT,
    built_at        TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX director_plans_space ON director_plans(space_id, id);

CREATE TABLE director_build_stages (
    id         INTEGER PRIMARY KEY,
    plan_id    INTEGER NOT NULL REFERENCES director_plans(id) ON DELETE CASCADE,
    stage      TEXT    NOT NULL CHECK (stage IN ('cast', 'world', 'beats')),
    state      TEXT    NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'applied')),
    payload    TEXT    NOT NULL DEFAULT '{}',
    applied_at TEXT,
    UNIQUE (plan_id, stage)
) STRICT;

CREATE TABLE director_plan_beats (
    id          INTEGER PRIMARY KEY,
    plan_id     INTEGER NOT NULL REFERENCES director_plans(id) ON DELETE CASCADE,
    tag         TEXT    NOT NULL,
    lane        INTEGER NOT NULL,
    brief       TEXT    NOT NULL,
    refs        TEXT    NOT NULL DEFAULT '[]',
    staging     TEXT    NOT NULL DEFAULT '{}',
    state       TEXT    NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'writing', 'written', 'failed')),
    error       TEXT,
    node_ids    TEXT    NOT NULL DEFAULT '[]',
    started_at  TEXT,
    finished_at TEXT,
    UNIQUE (plan_id, tag)
) STRICT;
