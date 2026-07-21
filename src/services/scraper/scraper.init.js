// @ts-nocheck
// src/services/scraper/scraper.init.js
// Phase 1 — Initialization: load sources, create session, set up counters.

const prisma = require("../../config/prisma");
const { validateScrapingUrl } = require("../../utils/scraperSecurity");


// PHASE 1 — INITIALIZATION


// Loads all active scraping sources from the database and validates each URL for security.
// Returns sources grouped by category plus a list of any blocked sources.
async function loadConfiguration() {
  console.log("[Phase 1] loadConfiguration() — fetching active sources from DB...");

  const sources = await prisma.scrapingSource.findMany({
    where: { status: "active" },
    select: {
      id:               true,
      name:             true,
      url:              true,
      category:         true,
      scrapeWindow:     true,
      minWordCount:     true,
      excludedKeywords: true,
    },
  });

  if (!sources.length) {
    console.log("[Phase 1] No active scraping sources found.");
    return { categories: [], sourcesByCategory: {}, totalSources: 0, blockedSources: [] };
  }

  // SSRF check — validates every source URL before allowing any HTTP requests
  const safeSources    = [];
  const blockedSources = [];

  for (const src of sources) {
    const check = await validateScrapingUrl(src.url);
    if (!check.safe) {
      console.warn(`[Phase 1] 🔒 BLOCKED source "${src.name}" (${src.url}): ${check.reason}`);
      blockedSources.push({ ...src, blockReason: check.reason });
    } else {
      safeSources.push(src);
    }
  }

  if (blockedSources.length > 0) {
    console.warn(`[Phase 1] 🔒 ${blockedSources.length} source(s) blocked by SSRF security checks`);
  }

  // Group safe sources by category: { "Technology": [...], "Health": [...] }
  const sourcesByCategory = {};
  for (const src of safeSources) {
    const cat = src.category || "Uncategorized";
    if (!sourcesByCategory[cat]) sourcesByCategory[cat] = [];
    sourcesByCategory[cat].push(src);
  }

  const categories = Object.keys(sourcesByCategory);
  console.log(`[Phase 1] Loaded ${safeSources.length} safe sources across ${categories.length} categories: ${categories.join(", ")}`);

  return { categories, sourcesByCategory, totalSources: safeSources.length, blockedSources };
}

// Finds the completion date of the most recent successful session.
async function getLastSuccessfulScrapeDate() {
  const last = await prisma.scrapingSession.findFirst({
    where:   { status: "completed" },
    orderBy: { completedAt: "desc" },
    select:  { completedAt: true },
  });
  const date = last?.completedAt || null;
  console.log(`[Phase 1] Last successful scrape: ${date ? date.toISOString() : "never"}`);
  return date;
}

// Creates the ScrapingSession row at the start of the job and returns its ID.
async function createScrapingSessionLog(totalSources, lastScrapeDate) {
  console.log("[Phase 1] createScrapingSessionLog()...");

  const session = await prisma.scrapingSession.create({
    data: { status: "running", lastScrapeDate, totalSources },
  });

  console.log(`[Phase 1] Session created → id: ${session.id}`);
  return session.id;
}

// Creates in-memory success/failure counters for each category.
function initializeCategoryCounters(categories) {
  console.log("[Phase 1] initializeCategoryCounters()...");
  const counters = {};
  for (const cat of categories) {
    counters[cat] = { successCount: 0, failureCount: 0, duplicateCount: 0, urlsProcessed: 0 };
  }
  return counters;
}

module.exports = {
  loadConfiguration,
  getLastSuccessfulScrapeDate,
  createScrapingSessionLog,
  initializeCategoryCounters,
};
