-- Mini Katana P3: what an export or pack job needs beyond 006's cut_exports row (01-core.md §6, §8).
-- One table serves Export and Pack (`kind`); there is no separate packs table.
ALTER TABLE cut_exports ADD COLUMN preset TEXT;          -- 'master' | 'youtube' (export-presets.js); NULL for a pack
ALTER TABLE cut_exports ADD COLUMN snapshot TEXT;        -- {revision, items, sound, settings} as pressed: later edits never change a running job
ALTER TABLE cut_exports ADD COLUMN options TEXT;         -- pack: {include_prompts}
ALTER TABLE cut_exports ADD COLUMN error_code TEXT;      -- limits | clip | timeout | tools | disk | closed | gone | failed
ALTER TABLE cut_exports ADD COLUMN report TEXT;          -- {skipped[], loudness, poster_path, files[], total_ms}
ALTER TABLE cut_exports ADD COLUMN started_at TEXT;
CREATE INDEX cut_exports_status ON cut_exports(status, id);
