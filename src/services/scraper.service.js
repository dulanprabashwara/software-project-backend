// @ts-nocheck
// src/services/scraper.service.js
// Phase 1 (Init) + Phase 2 (Scraping) of the weekly content pipeline.
// Phase 1: Load sources from DB → create session → init counters.
// Phase 2: Per source — fetch homepage → collect article links → scrape each → validate → save.

const prisma = require("../config/prisma");

const { wakeUpDatabase }                                        = require("./scraper/scraper.utils");
const { loadConfiguration, getLastSuccessfulScrapeDate,
        createScrapingSessionLog, initializeCategoryCounters }  = require("./scraper/scraper.init");
const { scrapeSource }                                          = require("./scraper/scraper.source");
const { logScrapingEvent, saveCategoryScrapingStats }           = require("./scraper/scraper.db");
const { validateSessionCounters, validateEnrichmentCounters,
        validateKeywordCounters }                               = require("./scraper/scraper.counters");
const { checkCriticalErrors, buildCrashReport }                 = require("./scraper/scraper.reports");

// ════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — exported, called by scraper.job.js
// ════════════════════════════════════════════════════════════════════════════

// Runs the full scraping pipeline: Phase 1 (init) → Phase 2 (scrape) → Phase 3 (enrich + email).
async function runScrapingSession() {
  const { runEnrichmentStage }                         = require("./enrichment.service");
  const { sendCompletionNotification, sendErrorAlert } = require("./email.service");
  const { CATEGORY_KEYWORDS }                          = require("../config/categoryKeywords");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`[Scraper] 🚀 Session started: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}\n`);

  let sessionId  = null;
  let config     = null;
  let counters   = {};
  const startTime = Date.now();

  let cleanupCalled = false;

  const cleanup = async (signal) => {
    if (cleanupCalled) return;
    cleanupCalled = true;

    console.warn(`\n[Scraper] ⚠️  ${signal} received — stopping.`);

    if (!sessionId) {
      process.exit(0);
    }

    // Check current session status before doing anything — the session may have
    // already completed normally. A completed or failed session must never be reverted.
    try {
      const current = await prisma.scrapingSession.findUnique({
        where:  { id: sessionId },
        select: { status: true },
      });

      if (current?.status === "completed" || current?.status === "failed") {
        console.log(`[Scraper] Session ${sessionId} already ${current.status} — signal ignored.`);
        process.exit(0);
      }
    } catch {
      // If the DB check itself fails, proceed with cancel to be safe
    }

    // Sum in-memory counters accumulated so far
    const totalSuccess   = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
    const totalDuplicate = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
    const totalFailure   = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
    const totalUrlsFound = validateSessionCounters(
      Object.values(counters).reduce((s, c) => s + c.urlsProcessed, 0),
      totalSuccess, totalDuplicate, totalFailure
    );

    // Mark canceled immediately with whatever stats are in memory.
    // reportSentAt is left null — cleanupStaleSessions() picks this up on
    // next server start, recovers any enrichment stats from ScrapedArticle,
    // and sends the email then. This avoids trying to send email from a
    // dying process on a tight timeout.
    prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        status:         "canceled",
        completedAt:    new Date(),
        criticalErrors: true,
        totalUrlsFound,
        successCount:   totalSuccess,
        duplicateCount: totalDuplicate,
        failureCount:   totalFailure,
      },
    }).catch((e) => console.error("[Scraper] DB cancel update failed:", e.message))
      .finally(() => process.exit(0));
  };

  process.once("SIGTERM", () => cleanup("SIGTERM"));
  process.once("SIGINT",  () => cleanup("SIGINT"));
  process.once("SIGHUP",  () => cleanup("SIGHUP")); // fires when terminal window is closed

  try {
    // ── Phase 1: Initialization ────────────────────────────────────────────

    await wakeUpDatabase();

    config = await loadConfiguration();
    if (!config.totalSources) {
      console.log("[Scraper] No active sources. Session skipped.");
      process.removeListener("SIGTERM", cleanup);
      process.removeListener("SIGINT",  cleanup);
      process.removeListener("SIGHUP",  cleanup);
      return;
    }

    const lastScrapeDate = await getLastSuccessfulScrapeDate();
    sessionId = await createScrapingSessionLog(config.totalSources, lastScrapeDate);
    counters  = initializeCategoryCounters(config.categories);

    await logScrapingEvent(sessionId, {
      logType: "info",
      url:     "session",
      reason:  `Initialized: ${config.categories.length} categories, ${config.totalSources} sources`,
    });

    if (config.blockedSources?.length > 0) {
      for (const blocked of config.blockedSources) {
        await logScrapingEvent(sessionId, {
          logType:  "http_error",
          url:      blocked.url,
          category: blocked.category,
          reason:   `SECURITY BLOCK: ${blocked.blockReason}`,
          details:  { sourceName: blocked.name, securityBlock: true },
        });
      }
      console.warn(`[Phase 1] 🔒 ${config.blockedSources.length} source(s) blocked — see session logs`);
    }

    // ── Phase 2: Scraping ──────────────────────────────────────────────────

    for (const category of config.categories) {
      const sources = config.sourcesByCategory[category];
      console.log(`\n[Phase 2] ══ Category: "${category}" (${sources.length} sources) ══`);

      for (const source of sources) {
        await scrapeSource(source, sessionId, counters);
      }

      await saveCategoryScrapingStats(sessionId, category, counters);
    }

    const totalSuccess   = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
    const totalDuplicate = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
    const totalFailure   = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
    const totalUrlsFound = validateSessionCounters(
      Object.values(counters).reduce((s, c) => s + c.urlsProcessed, 0),
      totalSuccess,
      totalDuplicate,
      totalFailure
    );

    console.log(`\n[Phase 2] Complete: ✅${totalSuccess} saved | ♻️${totalDuplicate} dupes | ❌${totalFailure} failed`);

    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        totalUrlsFound,
        successCount:   totalSuccess,
        duplicateCount: totalDuplicate,
        failureCount:   totalFailure,
      },
    });

    // ── Phase 3: Enrichment + Reporting ───────────────────────────────────

    let enrichmentStats = {
      keywordsWithContent:    [],
      keywordsWithoutContent: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };

    try {
      enrichmentStats = await runEnrichmentStage(sessionId);
    } catch (err) {
      console.error(`[Phase 3] Enrichment stage failed: ${err.message}`);
      await logScrapingEvent(sessionId, {
        logType: "info",
        url:     "enrichment",
        reason:  `Enrichment stage failed: ${err.message}`,
      });
    }

    const durationMinutes = (Date.now() - startTime) / 60000;
    const attempted       = totalSuccess + totalFailure;
    const successRate     = attempted > 0 ? (totalSuccess / attempted) * 100 : 0;

    const report = {
      sessionId,
      startedAt:              new Date(startTime).toISOString(),
      completedAt:            new Date().toISOString(),
      durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
      totalSources:           config.totalSources,
      totalUrlsFound,
      successCount:           totalSuccess,
      duplicateCount:         totalDuplicate,
      failureCount:           totalFailure,
      successRate:            parseFloat(successRate.toFixed(2)),
      enrichedCount:          enrichmentStats.enrichedCount       || 0,
      enrichmentFailed:       enrichmentStats.enrichmentFailed    || 0,
      keywordsWithContent:    enrichmentStats.keywordsWithContent  || [],
      keywordsWithoutContent: enrichmentStats.keywordsWithoutContent || [],
      totalKeywordsCovered:   (enrichmentStats.keywordsWithContent || []).length,
      totalKeywordsEmpty:     (enrichmentStats.keywordsWithoutContent || []).length,
      aiTokenUsage:           enrichmentStats.tokenUsage,
      criticalErrors:         false,
      isInterrupted:          false,
      securityBlockedSources: (config.blockedSources || []).length,
    };

    const criticalIssues  = checkCriticalErrors(report, counters);
    report.criticalErrors = criticalIssues.length > 0;

    // Validate enrichment math: enriched + failed must not exceed total scraped articles
    report.enrichmentFailed = validateEnrichmentCounters(
      report.successCount,
      report.enrichedCount,
      report.enrichmentFailed
    );

    // Validate keyword coverage math: covered + empty must equal total keywords in system
    const totalKeywordsInSystem = Object.values(CATEGORY_KEYWORDS).reduce((s, kws) => s + kws.length, 0);
    const validatedKeywords     = validateKeywordCounters(
      report.totalKeywordsCovered,
      report.totalKeywordsEmpty,
      totalKeywordsInSystem
    );
    report.totalKeywordsCovered = validatedKeywords.keywordsCoveredCount;
    report.totalKeywordsEmpty   = validatedKeywords.keywordsEmptyCount;

    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        status:                "completed",
        completedAt:           new Date(),
        successRate:           report.successRate,
        durationMinutes:       report.durationMinutes,
        enrichedCount:         report.enrichedCount,
        enrichmentFailedCount: report.enrichmentFailed,
        keywordsCoveredCount:  report.totalKeywordsCovered,
        keywordsEmptyCount:    report.totalKeywordsEmpty,
        aiInputTokens:         report.aiTokenUsage?.inputTokens  || 0,
        aiOutputTokens:        report.aiTokenUsage?.outputTokens || 0,
        criticalErrors:        report.criticalErrors,
        reportData:            JSON.stringify(report),
      },
    });

    if (report.criticalErrors) {
      console.warn(`[Phase 3] ⚠️  Critical errors: ${criticalIssues.join(" | ")}`);
      await sendErrorAlert(report, criticalIssues).catch((e) =>
        console.error("[Phase 3] Error alert email failed:", e.message)
      );
    }

    await sendCompletionNotification(report).catch((e) =>
      console.error("[Phase 3] Completion email failed:", e.message)
    );

    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data:  { reportSentAt: new Date() },
    }).catch((e) => console.error("[Phase 3] Failed to set reportSentAt:", e.message));

    process.removeListener("SIGTERM", cleanup);
    process.removeListener("SIGINT",  cleanup);
    process.removeListener("SIGHUP",  cleanup);

    console.log(`\n${"═".repeat(60)}`);
    console.log(`[Scraper] 🏁 Session complete. ${report.successCount} articles saved. ${report.totalKeywordsCovered} keywords covered.`);
    console.log(`${"═".repeat(60)}\n`);

    return { status: "completed", sessionId };

  } catch (err) {
    console.error(`[Scraper] ❌ Session crashed: ${err.message}`);

    process.removeListener("SIGTERM", cleanup);
    process.removeListener("SIGINT",  cleanup);
    process.removeListener("SIGHUP",  cleanup);

    if (sessionId) {
      // Read whatever partial enrichment stats were written to the session row
      // before the crash — runEnrichmentStage now writes after each category.
      let enrichedCount         = 0;
      let enrichmentFailedCount = 0;
      let aiInputTokens         = 0;
      let aiOutputTokens        = 0;

      try {
        const partial = await prisma.scrapingSession.findUnique({
          where:  { id: sessionId },
          select: { enrichedCount: true, enrichmentFailedCount: true, aiInputTokens: true, aiOutputTokens: true },
        });
        if (partial) {
          enrichedCount         = partial.enrichedCount         || 0;
          enrichmentFailedCount = partial.enrichmentFailedCount || 0;
          aiInputTokens         = partial.aiInputTokens         || 0;
          aiOutputTokens        = partial.aiOutputTokens        || 0;
        }
      } catch {
        // If this read fails the crash report still sends with zeros — acceptable
      }

      await prisma.scrapingSession.update({
        where: { id: sessionId },
        data: {
          status:         "failed",
          completedAt:    new Date(),
          criticalErrors: true,
          reportData:     JSON.stringify({ error: err.message }),
        },
      }).catch(() => {});

      const crashReport = buildCrashReport(sessionId, startTime, config, counters, err.message);

      // Overlay the partial enrichment stats into the crash report
      crashReport.enrichedCount    = enrichedCount;
      crashReport.enrichmentFailed = enrichmentFailedCount;
      crashReport.aiTokenUsage     = {
        inputTokens:      aiInputTokens,
        outputTokens:     aiOutputTokens,
        estimatedCostUSD: 0,
      };

      await sendCompletionNotification(crashReport).catch((e) =>
        console.error("[Scraper] Crash notification email failed:", e.message)
      );
    }

    throw err;
  }
}

module.exports = { runScrapingSession };