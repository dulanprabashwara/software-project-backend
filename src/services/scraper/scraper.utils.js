// @ts-nocheck
// src/services/scraper/scraper.utils.js
// Shared utility helpers for the scraping pipeline.

const prisma = require("../../config/prisma");
const { validateRedirectUrl } = require("../../utils/scraperSecurity");
const { DB_WAKEUP_DELAYS_MS } = require("./scraper.constants");

// ════════════════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ════════════════════════════════════════════════════════════════════════════

// Converts the admin scrapeWindow string (e.g. "Last 7 Days") to a day count.
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

  const dayMatch   = val.match(/^(?:last\s+)?(\d+)\s*days?$/);
  if (dayMatch) return parseInt(dayMatch[1]);

  const monthMatch = val.match(/^(\d+)\s*months?$/);
  if (monthMatch) return parseInt(monthMatch[1]) * 30;

  const yearMatch  = val.match(/^(\d+)\s*years?$/);
  if (yearMatch) return parseInt(yearMatch[1]) * 365;

  console.warn(`[Scraper] Unknown scrapeWindow value: "${scrapeWindow}" — no age limit applied`);
  return null;
}

// Counts words in a text string.
function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// Pauses execution for the given number of milliseconds.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pings the database to ensure it's awake before the session starts (NeonDB free tier suspends after inactivity).
async function wakeUpDatabase(maxAttempts = 5) {
  const delays = DB_WAKEUP_DELAYS_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = delays[attempt - 1] || 20000;

    if (delay > 0) {
      console.log(`[DB Wake-up] Waiting ${delay / 1000}s before retry ${attempt}/${maxAttempts}...`);
      await sleep(delay);
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(attempt > 1
        ? `[DB Wake-up] ✅ Database woke up on attempt ${attempt}`
        : "[DB Wake-up] ✅ Database connection confirmed"
      );
      return;
    } catch (err) {
      console.warn(`[DB Wake-up] ⚠️  Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }

  throw new Error(
    `Database unreachable after ${maxAttempts} attempts. ` +
    `NeonDB may be down or DATABASE_URL is incorrect. Session aborted.`
  );
}

// Strips the leading "www." from a hostname for domain comparison purposes.
function normalizeDomainForComparison(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

// Validates a redirect URL against the original hostname, allowing legitimate www↔non-www redirects.
function isRedirectAllowedDomain(redirectUrl, originalHostname) {
  const strictCheck = validateRedirectUrl(redirectUrl, originalHostname);
  if (strictCheck.safe) return { safe: true };

  if (strictCheck.reason && strictCheck.reason.startsWith("Cross-domain redirect")) {
    try {
      const redirectHostname = new URL(redirectUrl).hostname.toLowerCase();
      const normRedirect     = normalizeDomainForComparison(redirectHostname);
      const normOriginal     = normalizeDomainForComparison(originalHostname);

      const sameAfterNorm =
        normRedirect === normOriginal ||
        normRedirect.endsWith("." + normOriginal) ||
        normOriginal.endsWith("." + normRedirect);

      if (sameAfterNorm) return { safe: true };
    } catch {
      // URL parse failed — keep the original block
    }
  }

  return strictCheck;
}

module.exports = {
  parseScrapeWindowToDays,
  countWords,
  sleep,
  wakeUpDatabase,
  normalizeDomainForComparison,
  isRedirectAllowedDomain,
};
