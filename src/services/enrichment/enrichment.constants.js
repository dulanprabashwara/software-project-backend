// @ts-nocheck
// src/services/enrichment/enrichment.constants.js
// All shared constants for the enrichment pipeline.

// Batch and delay settings
const BATCH_SIZE             = 3;    // articles per AI call
const API_CALL_DELAY_MS      = 1200; // delay between batches
const KEY_SWITCH_PAUSE_MS    = 300;  // pause before switching to the next API key after a 429
const ARTICLE_RETRY_DELAY_MS = 500;  // delay between individual article retries in fallback mode

// AI call settings
const MAX_TOKENS_BATCH      = 900;   // max output tokens for batch calls
const MAX_TOKENS_INDIVIDUAL = 600;   // max output tokens for individual article fallback calls
const AI_TEMPERATURE        = 0.1;   // low temperature for consistent, factual output
const MAX_CONTENT_CHARS     = 10000; // max article content characters sent to the AI per article

// Summary length constraints (reflected in the AI prompt)
const SUMMARY_MIN_WORDS = 130;
const SUMMARY_MAX_WORDS = 150;

// Rate limit and backoff settings
const RATE_LIMIT_RESET_MS = 60000;                                    // OpenRouter rate limit window
const BACKOFF_DELAYS_MS   = [2000, 4000, 8000, 16000, 30000, 60000]; // exponential backoff sequence

// Token cost rates (USD per token) — only applied when a paid (non-free) model was used
const AI_TOKEN_COST_INPUT  = 0.00000015;
const AI_TOKEN_COST_OUTPUT = 0.0000006;

module.exports = {
  BATCH_SIZE,
  API_CALL_DELAY_MS,
  KEY_SWITCH_PAUSE_MS,
  ARTICLE_RETRY_DELAY_MS,
  MAX_TOKENS_BATCH,
  MAX_TOKENS_INDIVIDUAL,
  AI_TEMPERATURE,
  MAX_CONTENT_CHARS,
  SUMMARY_MIN_WORDS,
  SUMMARY_MAX_WORDS,
  RATE_LIMIT_RESET_MS,
  BACKOFF_DELAYS_MS,
  AI_TOKEN_COST_INPUT,
  AI_TOKEN_COST_OUTPUT,
};
