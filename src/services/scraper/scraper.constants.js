// @ts-nocheck
// src/services/scraper/scraper.constants.js
// Shared constants used across the scraping pipeline.

// ── Constants ──────────────────────────────────────────────────────────────────

// Scraping limits
const MAX_ARTICLES_PER_SOURCE    = 7;    // max articles saved per source per session
const CANDIDATE_LINKS_PER_SOURCE = 25;   // links collected before dedup filtering
const RATE_LIMIT_MIN_MS          = 1500; // minimum polite delay between HTTP requests
const RATE_LIMIT_MAX_MS          = 2500; // maximum polite delay between HTTP requests
const HTTP_RETRY_DELAY_MS        = 3000; // wait before retrying a failed HTTP request

// DB wake-up retry delays (NeonDB free tier suspends after inactivity)
const DB_WAKEUP_DELAYS_MS = [0, 5000, 10000, 15000, 20000];

// Content validation thresholds
const DEFAULT_MIN_WORD_COUNT       = 300; // fallback if source has no minWordCount configured
const MIN_CONTENT_CHARS            = 400; // minimum characters after cleaning
const MIN_TEXT_SEGMENT_CHARS       = 30;  // minimum characters for a heading/paragraph to be kept
const MIN_TITLE_LENGTH             = 10;  // minimum characters for a valid title
const MIN_PARAGRAPH_COUNT          = 2;   // minimum paragraph breaks required

// Critical error thresholds for the session report
const CRITICAL_SUCCESS_RATE_THRESHOLD      = 50; // % — below this triggers an error alert
const CRITICAL_FAILED_CATEGORIES_THRESHOLD = 2;  // categories with zero success triggers alert

module.exports = {
  MAX_ARTICLES_PER_SOURCE,
  CANDIDATE_LINKS_PER_SOURCE,
  RATE_LIMIT_MIN_MS,
  RATE_LIMIT_MAX_MS,
  HTTP_RETRY_DELAY_MS,
  DB_WAKEUP_DELAYS_MS,
  DEFAULT_MIN_WORD_COUNT,
  MIN_CONTENT_CHARS,
  MIN_TEXT_SEGMENT_CHARS,
  MIN_TITLE_LENGTH,
  MIN_PARAGRAPH_COUNT,
  CRITICAL_SUCCESS_RATE_THRESHOLD,
  CRITICAL_FAILED_CATEGORIES_THRESHOLD,
};
