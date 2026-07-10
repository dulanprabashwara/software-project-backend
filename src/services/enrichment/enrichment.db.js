// @ts-nocheck
// src/services/enrichment/enrichment.db.js
// Database read/write operations for the enrichment pipeline.

const prisma                = require("../../config/prisma");
const { CATEGORY_KEYWORDS } = require("../../config/categoryKeywords");

// Writes a single enrichment event to the ScrapingLog table.
async function writeLog(sessionId, logType, url, category, reason, details = {}) {
  await prisma.scrapingLog.create({
    data: { sessionId, logType, url, category, reason, details },
  });
}

// Counts how many articles in a session matched each keyword, split into covered vs uncovered.
async function buildKeywordCoverageReport(sessionId) {
  const keywordsWithContent    = [];
  const keywordsWithoutContent = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      const count = await prisma.scrapedArticle.count({
        where: { sessionId, category, matchedKeywords: { has: keyword } },
      });

      if (count > 0) {
        keywordsWithContent.push({ keyword, category, articleCount: count });
      } else {
        keywordsWithoutContent.push(keyword);
      }
    }
  }

  return {
    keywordsWithContent,
    keywordsWithoutContent: [...new Set(keywordsWithoutContent)],
  };
}

module.exports = { writeLog, buildKeywordCoverageReport };
