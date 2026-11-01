-- 0022_sprints.sql (v2.9): sprints per project. projects.sprints is a JSON array of Sprint (shared/sprints.ts), sealed on work rows;
-- tasks.sprint_id is the id of the sprint a task is in (a plain id, not sealed). Plain ALTERs; no table is rebuilt.
ALTER TABLE projects ADD COLUMN sprints TEXT;
ALTER TABLE tasks ADD COLUMN sprint_id TEXT;
