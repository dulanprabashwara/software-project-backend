// @ts-nocheck
// src/services/scraper/scraper.db.js
// Database read/write operations for the scraping pipeline.

const prisma = require("../../config/prisma");
const { sanitizeContent, sanitizeTitle } = require("../../utils/scraperSecurity");
const { validateCounters } = require("./scraper.counters");

// Checks the database for an existing article with the same URL.
async function checkDuplicateArticle(url) {
  const existing = await prisma.scrapedArticle.findUnique({
    where:  { sourceUrl: url },
    select: { id: true },
  });
  return existing !== null;
}

// Saves a cleaned article to the database (summary and keywords are null until enrichment).
async function saveScrapedArticle({
  url, title, content, author, publishedDate,
  wordCount, category, scrapingSourceId, metadata, sessionId,
}) {
  // Final sanitization before writing to the database
  const cleanTitle   = sanitizeTitle(title);
  const cleanContent = sanitizeContent(content);
  const cleanAuthor  = author ? sanitizeTitle(author) : null;

  return prisma.scrapedArticle.create({
    data: {
      sourceUrl:        url,
      title:            cleanTitle,
      content:          cleanContent,
      author:           cleanAuthor,
      publishedDate:    (publishedDate && !isNaN(publishedDate)) ? publishedDate : null,
      wordCount,
      category,
      scrapingSourceId,
      metadata:         metadata || null,
      summary:          null,
      matchedKeywords:  [],
      sessionId,
    },
  });
}

// Writes a single event (success, failure, duplicate, etc.) to the ScrapingLog table.
async function logScrapingEvent(sessionId, { logType, url, category, statusCode, reason, details }) {
  await prisma.scrapingLog.create({
    data: {
      sessionId,
      logType,
      url:        url        || "",
      category:   category   || null,
      statusCode: statusCode || null,
      reason:     reason     || null,
      details:    details    || null,
    },
  }).catch((err) => console.error(`[ScrapingLog] Write failed: ${err.message}`));
}

// Saves the scraping result counters for one category to the CategoryScrapingStats table.
async function saveCategoryScrapingStats(sessionId, category, counters) {
  const c = counters[category];

  validateCounters(category, c);

  await prisma.categoryScrapingStats.create({
    data: {
      sessionId,
      category,
      urlsProcessed:  c.urlsProcessed,
      successCount:   c.successCount,
      duplicateCount: c.duplicateCount,
      failureCount:   c.failureCount,
    },
  });
  console.log(
    `[Phase 2] Stats saved for "${category}": ` +
    `🔗${c.urlsProcessed} processed | ✅${c.successCount} saved | ♻️${c.duplicateCount} dupes | ❌${c.failureCount} failed`
  );
}

module.exports = {
  checkDuplicateArticle,
  saveScrapedArticle,
  logScrapingEvent,
  saveCategoryScrapingStats,
};
