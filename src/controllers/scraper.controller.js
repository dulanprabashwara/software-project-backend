// src/controllers/scraper.controller.js
// Admin-only HTTP endpoints for scraping management.

const { runScrapingSession } = require("../services/scraper.service");
const asyncHandler            = require("../utils/asyncHandler");
const ApiError                = require("../utils/ApiError");
const prisma                  = require("../config/prisma");

// POST /api/scraper/trigger
// Manually starts a scraping session in background. Responds 202 immediately.
const triggerScraping = asyncHandler(async (req, res) => {
  runScrapingSession().catch((err) =>
    console.error("[Controller] Manual trigger error:", err.message)
  );
  res.status(202).json({
    success: true,
    message: "Scraping session started. Check GET /api/scraper/sessions for progress.",
  });
});
  
// POST /api/scraper/enrich
// Manually runs the enrichment stage for unenriched articles.
// Optional body: { sessionId: "...", category: "..." }

const triggerEnrichment = asyncHandler(async (req, res) => {
  const { sessionId = null, category = null } = req.body || {};
 
  const { runManualEnrichment } = require("../services/enrichment.service");
 
  runManualEnrichment({ sessionId, category }).catch((err) =>
    console.error("[Controller] Manual enrichment error:", err.message)
  );
 
  res.status(202).json({
    success: true,
    message: sessionId
      ? `Enrichment started for session ${sessionId}.`
      : "Enrichment started for all unenriched articles.",
    note: "This runs in the background. Check Prisma Studio or GET /api/scraper/sessions for results.",
  });
});

// GET /api/scraper/sessions
// Returns the 20 most recent sessions with headline stats.
const getSessions = asyncHandler(async (req, res) => {
  const sessions = await prisma.scrapingSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    select: {
      id: true, startedAt: true, completedAt: true, status: true,
      totalSources: true, successCount: true, duplicateCount: true,
      failureCount: true, successRate: true, durationMinutes: true,
      enrichedCount: true, keywordsCoveredCount: true, criticalErrors: true,
      reportSentAt: true, aiInputTokens: true, aiOutputTokens: true,
    },
  });
  res.status(200).json({ success: true, sessions });
});

// GET /api/scraper/sessions/:sessionId
// Full detail for one session including logs and keyword stats.
const getSessionById = asyncHandler(async (req, res) => {
  const session = await prisma.scrapingSession.findUnique({
    where:   { id: req.params.sessionId },
    include: {
      keywordStats: { orderBy: { createdAt: "asc" } },
      logs: { orderBy: { loggedAt: "desc" }, take: 200 },
    },
  });
  if (!session) throw ApiError.notFound("Session not found.");
  res.status(200).json({ success: true, session });
});

// GET /api/scraper/articles?category=Technology&limit=20&skip=0
// Paginated list of scraped articles.
const getScrapedArticles = asyncHandler(async (req, res) => {
  const { category, keyword, limit = "20", skip = "0" } = req.query;
  const where = {};
  if (category) where.category = category;
  if (keyword)  where.matchedKeywords = { has: keyword };

  const [articles, total] = await Promise.all([
    prisma.scrapedArticle.findMany({
      where,
      orderBy: { scrapedAt: "desc" },
      take: parseInt(limit),
      skip: parseInt(skip),
      select: {
        id: true, title: true, sourceUrl: true, category: true,
        wordCount: true, author: true, publishedDate: true,
        scrapedAt: true, matchedKeywords: true,
        summary: true,
      },
    }),
    prisma.scrapedArticle.count({ where }),
  ]);

  res.status(200).json({ success: true, total, articles });
});

module.exports = { triggerScraping,triggerEnrichment, getSessions, getSessionById, getScrapedArticles };
