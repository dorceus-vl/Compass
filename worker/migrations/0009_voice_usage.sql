-- Phase 5b Task 4: Athena's voice is metered like model calls, so ai_usage admits the features athena_voice (text-to-speech) and
-- athena_listen (speech-to-text) and the provider elevenlabs. For those rows input_tokens holds characters (voice) or seconds (listen).
-- SQLite cannot widen a CHECK in place, so the table is rebuilt; nothing points at ai_usage.
CREATE TABLE ai_usage_new (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, feature TEXT NOT NULL CHECK (feature IN ('copilot','status_report','plan_review','brief','athena_voice','athena_listen')),
  provider TEXT NOT NULL CHECK (provider IN ('claude','gemini','elevenlabs')), input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cost_micro INTEGER NOT NULL
);
INSERT INTO ai_usage_new SELECT id, at, feature, provider, input_tokens, output_tokens, cost_micro FROM ai_usage;
DROP TABLE ai_usage;
ALTER TABLE ai_usage_new RENAME TO ai_usage;
CREATE INDEX idx_ai_usage_at ON ai_usage(at);
