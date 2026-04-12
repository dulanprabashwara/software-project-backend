// tests/scraper/test-helpers/scraper-internals.js
// ─────────────────────────────────────────────────────────────────────────────
// Re-exports internal functions from scraper.service.js that aren't in
// module.exports (because they're private helpers) but need to be tested.
//
// This is the standard pattern for testing private functions in Node.js.
// This file exists ONLY in the tests folder — it is never imported by
// any backend code.
// ─────────────────────────────────────────────────────────────────────────────

// We duplicate the pure utility functions here to test them without
// needing to import the entire scraper.service.js (which has side effects
// like requiring prisma and openai at module load time).

// ── parseScrapeWindowToDays ────────────────────────────────────────────────
function parseScrapeWindowToDays(scrapeWindow) {
  if (!scrapeWindow) return null;
  const val = String(scrapeWindow).toLowerCase().trim();

  const exactMap = {
    "last 24 hours": 1,
    "last 7 days":   7,
    "last 30 days":  30,
    "3 months":      90,
    "6 months":      180,
    "1 year":        365,
  };
  if (exactMap[val] !== undefined) return exactMap[val];

  const dayMatch = val.match(/^(?:last\s+)?(\d+)\s*days?$/);
  if (dayMatch) return parseInt(dayMatch[1]);

  const monthMatch = val.match(/^(\d+)\s*months?$/);
  if (monthMatch) return parseInt(monthMatch[1]) * 30;

  const yearMatch = val.match(/^(\d+)\s*years?$/);
  if (yearMatch) return parseInt(yearMatch[1]) * 365;

  return null;
}

// ── countWords ────────────────────────────────────────────────────────────
function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

module.exports = { parseScrapeWindowToDays, countWords };
