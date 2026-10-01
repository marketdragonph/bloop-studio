-- Image and video cards no longer have their own prompt box: their words come only from wired
-- Text cards. Any direction already typed into one moves into a new Text card wired into it.
CREATE TEMP TABLE moved_direction AS
    SELECT id AS card_id, space_id, position_x, position_y, trim(prompt) AS words
    FROM space_nodes
    WHERE type IN ('image', 'video') AND trim(coalesce(prompt, '')) <> '';

ALTER TABLE moved_direction ADD COLUMN text_id INTEGER;

INSERT INTO space_nodes (space_id, type, label, position_x, position_y, text_content)
    -- In a new row under the whole board, below its own card's column (the board tidies the stack on open).
    SELECT space_id, 'text', 'Direction · #' || card_id, position_x,
           (SELECT max(n.position_y) FROM space_nodes n WHERE n.space_id = moved_direction.space_id) + 700, words
    FROM moved_direction;

UPDATE moved_direction SET text_id = (
    SELECT n.id FROM space_nodes n
    WHERE n.space_id = moved_direction.space_id AND n.type = 'text' AND n.label = 'Direction · #' || moved_direction.card_id
    ORDER BY n.id DESC LIMIT 1
);

INSERT OR IGNORE INTO space_connections (space_id, from_node_id, to_node_id, to_socket)
    SELECT space_id, text_id, card_id, 'prompt' FROM moved_direction WHERE text_id IS NOT NULL;

UPDATE space_nodes SET prompt = NULL WHERE type IN ('image', 'video');

DROP TABLE moved_direction;
