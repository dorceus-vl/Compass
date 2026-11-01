-- 0023_pages.sql (v2.10): project wiki pages and agendas. projects.pages is a JSON array of Page (shared/pages.ts), sealed on work rows.
-- Plain ALTER; no table is rebuilt.
ALTER TABLE projects ADD COLUMN pages TEXT;
