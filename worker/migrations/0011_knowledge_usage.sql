-- Phase 6 Task 1: knowledge embeddings are metered like model calls, so ai_usage admits the feature knowledge_embed and the provider
-- workers_ai (Cloudflare Workers AI, bge-m3). For those rows input_tokens holds an estimate (characters / 4); output_tokens is 0.
-- SQLite cannot widen a CHECK in place, so the table is rebuilt as in 0009; nothing points at ai_usage.
CREATE TABLE ai_usage_new (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, feature TEXT NOT NULL CHECK (feature IN ('copilot','status_report','plan_review','brief','athena_voice','athena_listen','knowledge_embed')),
  provider TEXT NOT NULL CHECK (provider IN ('claude','gemini','elevenlabs','workers_ai')), input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cost_micro INTEGER NOT NULL
);
INSERT INTO ai_usage_new SELECT id, at, feature, provider, input_tokens, output_tokens, cost_micro FROM ai_usage;
DROP TABLE ai_usage;
ALTER TABLE ai_usage_new RENAME TO ai_usage;
CREATE INDEX idx_ai_usage_at ON ai_usage(at);
