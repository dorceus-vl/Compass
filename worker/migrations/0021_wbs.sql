-- 0021_wbs.sql (v2.8): work breakdown structure per project. projects.wbs is a JSON array of { id, title, depth } in outline order (shared/wbs.ts),
-- sealed on work rows; tasks.wbs_id is the id of the node a task hangs off (a plain id, not sealed). Plain ALTERs; no table is rebuilt.
ALTER TABLE projects ADD COLUMN wbs TEXT;
ALTER TABLE tasks ADD COLUMN wbs_id TEXT;
