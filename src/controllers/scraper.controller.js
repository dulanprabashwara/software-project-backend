// @ts-nocheck
// src/controllers/scraper.controller.js
// Admin-only HTTP endpoints for managing and monitoring scraping sessions.
const { runScrapingSession } = require("../services/scraper.service");

const asyncHandler = require("../utils/asyncHandler");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

// ── CONSTANTS ───────────────────────────────────────────────────────

// HTTP status codes
const HTTP_STATUS_ACCEPTED = 202;
const HTTP_STATUS_OK = 200;

// Pagination and query limits
const DEFAULT_SESSION_LIMIT = 20;
const DEFAULT_ARTICLE_LIMIT = 20;
const DEFAULT_LOG_LIMIT = 200;

// Starts a scraping session in the background and immediately returns 202.
const triggerScraping = asyncHandler(async (req, res) => {
  // Start scraping in background
  runScrapingSession().catch((err) =>
    console.error("[Controller] Manual trigger error:", err.message)
  );

  // Get the most recent session (the one we just started)
  const recentSession = await prisma.scrapingSession.findFirst({
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true },
  });

  // Use the authenticated user's email (the admin who triggered the action)
  const userEmail = req.user?.email || null;

  res.status(HTTP_STATUS_ACCEPTED).json({
    success: true,
    sessionId: recentSession?.id || null,
    status: recentSession?.status || "running",
    userEmail,
  });
});

// Starts enrichment in the background for unenriched articles.
// Optional body: { sessionId: "...", category: "..." }
const triggerEnrichment = asyncHandler(async (req, res) => {
  const { sessionId = null, category = null } = req.body || {};

  const { runManualEnrichment } = require("../services/enrichment.service");

  runManualEnrichment({ sessionId, category }).catch((err) =>
    console.error("[Controller] Manual enrichment error:", err.message)
  );

  // Get the most recent session for enrichment status tracking
  const recentSession = await prisma.scrapingSession.findFirst({
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, reportSentAt: true },
  });

  // Use the authenticated user's email (the admin who triggered the action)
  const userEmail = req.user?.email || null;

  res.status(HTTP_STATUS_ACCEPTED).json({
    success: true,
    sessionId: sessionId || recentSession?.id || null,
    status: "running",
    userEmail,
  });
});

// Returns the 20 most recent sessions with headline stats.
const getSessions = asyncHandler(async (req, res) => {
  const sessions = await prisma.scrapingSession.findMany({
    orderBy: { startedAt: "desc" },
    take: DEFAULT_SESSION_LIMIT,
    select: {
      id: true, startedAt: true, completedAt: true, status: true,
      totalSources: true, successCount: true, duplicateCount: true,
      failureCount: true, successRate: true, durationMinutes: true,
      enrichedCount: true, keywordsCoveredCount: true, criticalErrors: true,
      reportSentAt: true, aiInputTokens: true, aiOutputTokens: true,
    },
  });
  res.status(HTTP_STATUS_OK).json({ success: true, sessions });
});

// Returns full detail for one session including per-category stats and recent logs.
const getSessionById = asyncHandler(async (req, res) => {
  const session = await prisma.scrapingSession.findUnique({
    where:   { id: req.params.sessionId },
    include: {
      categoryStats: { orderBy: { sessionId: "asc"} },
      logs:          { orderBy: { loggedAt: "desc" }, take: DEFAULT_LOG_LIMIT },
    },
  });
  if (!session) throw ApiError.notFound("Session not found.");
  res.status(HTTP_STATUS_OK).json({ success: true, session });
});

// Returns a paginated list of scraped articles, optionally filtered by category or keyword.
const getScrapedArticles = asyncHandler(async (req, res) => {
  const { category, keyword, limit = DEFAULT_ARTICLE_LIMIT.toString(), skip = "0" } = req.query;
  const where = {};
  if (category) where.category = category;
  if (keyword)  where.matchedKeywords = { has: keyword };

  const [articles, total] = await Promise.all([
    prisma.scrapedArticle.findMany({
      where,
      orderBy: { scrapedAt: "desc" },
      take:    parseInt(limit),
      skip:    parseInt(skip),
      select: {
        id: true, title: true, sourceUrl: true, category: true,
        wordCount: true, author: true, publishedDate: true,
        scrapedAt: true, matchedKeywords: true, summary: true,
      },
    }),
    prisma.scrapedArticle.count({ where }),
  ]);

  res.status(HTTP_STATUS_OK).json({ success: true, total, articles });
});

module.exports = { triggerScraping, triggerEnrichment, getSessions, getSessionById, getScrapedArticles };
