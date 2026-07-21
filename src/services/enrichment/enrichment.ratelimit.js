// @ts-nocheck
// src/services/enrichment/enrichment.ratelimit.js
// Rate limit tracking and exponential backoff for OpenRouter API calls.

const { RATE_LIMIT_RESET_MS, BACKOFF_DELAYS_MS } = require("./enrichment.constants");

// Tracks whether the account is currently rate-limited and computes backoff wait times.
class RateLimitManager {
  constructor() {
    this.isAccountLimited = false;
    this.lastLimitTime    = null;
    this.limitResetTime   = null;
    this.failedBatchCount = 0;
  }

  // Marks the account as rate-limited, setting a 60-second reset window.
  markLimited() {
    this.isAccountLimited = true;
    this.lastLimitTime    = Date.now();
    this.limitResetTime   = Date.now() + RATE_LIMIT_RESET_MS;
  }

  // Returns true if the rate limit window has passed and we can try again.
  isLimitExpired() {
    if (!this.isAccountLimited) return false;
    if (Date.now() >= this.limitResetTime) {
      console.log("[RateLimit] Limit window expired. Retrying...");
      this.isAccountLimited = false;
      return true;
    }
    return false;
  }

  // Returns the next exponential backoff wait time in milliseconds.
  getWaitTime() {
    return BACKOFF_DELAYS_MS[Math.min(this.failedBatchCount, BACKOFF_DELAYS_MS.length - 1)];
  }
}

// Module-level singleton shared across all callOpenRouter calls in this process
const rateLimitMgr = new RateLimitManager();

// Detects rate limit (429) errors from any shape of OpenAI/OpenRouter error object.
function is429(err) {
  return (
    err.status === 429 ||
    err.statusCode === 429 ||
    (typeof err.message === "string" && err.message.includes("429"))
  );
}

module.exports = { RateLimitManager, rateLimitMgr, is429 };
