-- Mini Katana P6 (05-irresistible.md §5.4): one Export press makes one cut_exports row per shape of the Shapes row,
-- run one at a time on the media-tools queue. `variant` is the row's shape; `group_id` ties the rows of one press
-- (Export again re-runs the group). `options` (007) holds the row's captions, GIF and soft-bars choices as pressed.
ALTER TABLE cut_exports ADD COLUMN variant TEXT;   -- '16:9' | '9:16' | '1:1'; NULL for a pack and for P3 rows
ALTER TABLE cut_exports ADD COLUMN group_id TEXT;  -- shared by the rows of one press; NULL for a pack
CREATE INDEX cut_exports_group ON cut_exports(group_id);
