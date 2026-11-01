-- 0020_custom_fields.sql (v2.7): custom fields per project. projects.fields is a JSON array of { id, name, type, options? } (shared/fields.ts);
-- tasks.field_values is a JSON object { field id: value }. Both are sealed on work rows. Plain ALTERs; no table is rebuilt.
ALTER TABLE projects ADD COLUMN fields TEXT;
ALTER TABLE tasks ADD COLUMN field_values TEXT;
