// @ts-nocheck
// src/services/enrichment/enrichment.api.js
// OpenRouter API caller with multi-key, multi-model fallback and rate-limit handling.

const {
  MAX_TOKENS_BATCH,
  AI_TEMPERATURE,
  KEY_SWITCH_PAUSE_MS,
  AI_TOKEN_COST_INPUT,
  AI_TOKEN_COST_OUTPUT,
} = require("./enrichment.constants");

const { CLIENTS, ENRICHMENT_MODELS } = require("./enrichment.clients");
const { rateLimitMgr, is429 }        = require("./enrichment.ratelimit");

// Returns the estimated cost for a session's token usage.
// Cost is only calculated if a paid model was used — free models always return 0.
function calculateEstimatedCost(tokenTracker) {
  if (!tokenTracker.usedPaidModel) return 0;
  return parseFloat(
    ((tokenTracker.inputTokens * AI_TOKEN_COST_INPUT) + (tokenTracker.outputTokens * AI_TOKEN_COST_OUTPUT)).toFixed(4)
  );
}

// Sends a request to OpenRouter, trying every API key × every model in order.
// Falls back to exponential backoff if all keys and models are exhausted.
async function callOpenRouter(messages, maxTokens = MAX_TOKENS_BATCH, retryAttempt = 0) {
  if (rateLimitMgr.isAccountLimited && !rateLimitMgr.isLimitExpired()) {
    const waitMs = rateLimitMgr.getWaitTime();
    console.warn(`[RateLimit] Limit active. Waiting ${waitMs}ms before retrying...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  let lastError;

  for (const model of ENRICHMENT_MODELS) {
    for (let ki = 0; ki < CLIENTS.length; ki++) {
      const client   = CLIENTS[ki];
      const keyLabel = ki === 0 ? "primary" : `key-${ki + 1}`;

      try {
        const completion = await client.chat.completions.create({
          model,
          messages,
          max_tokens:  maxTokens,
          temperature: AI_TEMPERATURE,
        });

        const content = completion.choices[0]?.message?.content || "";
        const usage   = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };

        if (rateLimitMgr.isAccountLimited) {
          console.log(`[RateLimit] ✅ Recovered on ${keyLabel}/${model}. Resuming.`);
          rateLimitMgr.isAccountLimited = false;
          rateLimitMgr.failedBatchCount = 0;
        }

        return { content, usage, model, keyIndex: ki };

      } catch (err) {
        lastError = err;

        if (is429(err)) {
          console.warn(`[RateLimit] 429 on ${keyLabel}/${model} — trying next key...`);
          rateLimitMgr.markLimited();
          await new Promise((r) => setTimeout(r, KEY_SWITCH_PAUSE_MS));
          continue;
        }

        console.warn(`[Enrichment] ${keyLabel}/${model} error: ${err.message}`);
        break; // non-429 error: skip to next model
      }
    }
    rateLimitMgr.failedBatchCount++;
  }

  // All keys × all models exhausted — wait and retry once
  if (retryAttempt === 0) {
    const waitMs = rateLimitMgr.getWaitTime();
    console.warn(`[RateLimit] All keys/models exhausted. Waiting ${waitMs}ms then retrying once...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return callOpenRouter(messages, maxTokens, 1);
  }

  throw lastError || new Error("All API keys and models exhausted after retry");
}

module.exports = { callOpenRouter, calculateEstimatedCost };
