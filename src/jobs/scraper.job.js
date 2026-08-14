// @ts-nocheck
// src/jobs/scraper.job.js
// Weekly cron scheduler + stale session cleanup.
//
// Two types of abandoned sessions are handled:
//   "canceled" + reportSentAt=null — signal was caught, DB updated, email not yet sent
//   "running"  + older than 3h    — process was force-killed (SIGKILL), no handler ran

const cron   = require("node-cron");
const prisma = require("../config/prisma");
const { runScrapingSession }        = require("../services/scraper.service");
const { getLastSuccessfulScrapeDate } = require("../services/scraper/scraper.init");
 
const STALE_SESSION_TIMEOUT_MS = 3 * 60 * 60 * 1000;      // 3 hours — max time a real session runs
const SCRAPE_INTERVAL_MS       = 7 * 24 * 60 * 60 * 1000; // run again once 7 days have passed
const CHECK_CRON_PATTERN       = "*/15 * * * *";           // re-check every 15 minutes while awake
 
// Prevents two overlapping due-checks (e.g. a boot-check and a tick landing close together)
// from both deciding to start a run at the same time.
let isCheckingScraper = false;
 
// Queries ScrapedArticle to get the true saved/enriched counts for a session.
async function recoverSessionStats(sessionId) {
  const savedArticles    = await prisma.scrapedArticle.count({ where: { sessionId } });
  const enrichedArticles = await prisma.scrapedArticle.count({
    where: { sessionId, summary: { not: null } },
  });
 
  // Also read any enrichment token usage written by runEnrichmentStage mid-run
  const sessionRow = await prisma.scrapingSession.findUnique({
    where:  { id: sessionId },
    select: { aiInputTokens: true, aiOutputTokens: true, enrichmentFailedCount: true },
  });
 
  console.log(`[Cron] Session ${sessionId} — recovered: ${savedArticles} saved, ${enrichedArticles} enriched`);
 
  return {
    savedArticles,
    enrichedArticles,
    enrichmentFailed: sessionRow?.enrichmentFailedCount || 0,
    aiInputTokens:    sessionRow?.aiInputTokens  || 0,
    aiOutputTokens:   sessionRow?.aiOutputTokens || 0,
  };
}
 
// Finds abandoned sessions and resolves them: cancels stuck-running ones, sends emails
// for canceled ones that haven't been reported yet. Completed/failed sessions are never touched.
async function cleanupStaleSessions() {
  const staleRunningCutoff = new Date(Date.now() - STALE_SESSION_TIMEOUT_MS);
 
  const abandonedSessions = await prisma.scrapingSession.findMany({
    where: {
      reportSentAt: null,
      status: { notIn: ["completed", "failed"] }, // completed/failed sessions are never touched
      OR: [
        { status: "canceled" },
        { status: "running", startedAt: { lt: staleRunningCutoff } },
      ],
    },
    select: {
      id:                   true,
      status:               true,
      startedAt:            true,
      completedAt:          true,  // used for accurate duration calculation
      totalSources:         true,
      successCount:         true,
      duplicateCount:       true,
      failureCount:         true,
      enrichedCount:        true,
      keywordsCoveredCount: true,
      aiInputTokens:        true,
      aiOutputTokens:       true,
    },
  });
 
  if (!abandonedSessions.length) return;
 
  console.warn(`[Cron] ⚠️  Found ${abandonedSessions.length} abandoned session(s). Processing...`);
 
  for (const session of abandonedSessions) {
    // Use completedAt set by signal handler when available — avoids inflated duration
    const endTime         = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
    const durationMinutes = (endTime - new Date(session.startedAt).getTime()) / 60000;
 
    // Recover stats from ScrapedArticle if session row counters are all zero
    let successCount   = session.successCount   || 0;
    let duplicateCount = session.duplicateCount || 0;
    let failureCount   = session.failureCount   || 0;
    let enrichedCount  = session.enrichedCount  || 0;
    let enrichmentFailed = 0;
    let aiInputTokens  = session.aiInputTokens  || 0;
    let aiOutputTokens = session.aiOutputTokens || 0;
 
    const noStats = successCount === 0 && duplicateCount === 0 && failureCount === 0;
 
    try {
      const recovered = await recoverSessionStats(session.id);
 
      // Always use recovered enrichment stats — they include mid-enrichment writes
      enrichedCount    = recovered.enrichedArticles;
      enrichmentFailed = recovered.enrichmentFailed;
      aiInputTokens    = recovered.aiInputTokens;
      aiOutputTokens   = recovered.aiOutputTokens;
 
      // Only override scraping counters if they were zero (killed before Phase 2 wrote them)
      if (noStats) {
        successCount = recovered.savedArticles;
      }
    } catch (e) {
      console.error(`[Cron] Stat recovery failed for ${session.id}: ${e.message}`);
    }
 
    const totalUrlsFound = successCount + duplicateCount + failureCount;
    const attempted      = successCount + failureCount;
    const successRate    = attempted > 0
      ? parseFloat(((successCount / attempted) * 100).toFixed(2))
      : null;
 
    await prisma.scrapingSession.update({
      where: { id: session.id },
      data: {
        status:                "canceled",
        // Only set completedAt if not already set by the signal handler
        ...(session.completedAt ? {} : { completedAt: new Date() }),
        criticalErrors:        true,
        totalUrlsFound,
        successCount,
        duplicateCount,
        failureCount,
        enrichedCount,
        enrichmentFailedCount: enrichmentFailed,
        successRate,
        durationMinutes:       parseFloat(durationMinutes.toFixed(2)),
        aiInputTokens,
        aiOutputTokens,
      },
    }).catch((e) => console.error(`[Cron] Failed to update session ${session.id}: ${e.message}`));
 
    console.warn(`[Cron] Session ${session.id} (was: ${session.status}) — canceled after ${durationMinutes.toFixed(0)}m`);
 
    // Send interruption email then mark reportSentAt to prevent re-sending
    try {
      const { sendCompletionNotification } = require("../services/email.service");
 
      await sendCompletionNotification({
        sessionId:            session.id,
        startedAt:            session.startedAt,
        completedAt:          new Date().toISOString(),
        durationMinutes:      parseFloat(durationMinutes.toFixed(2)),
        totalSources:         session.totalSources,
        totalUrlsFound,
        successCount,
        duplicateCount,
        failureCount,
        successRate,
        enrichedCount,
        enrichmentFailed,
        totalKeywordsCovered: session.keywordsCoveredCount || 0,
        totalKeywordsEmpty:   0,
        keywordsWithContent:  [],
        keywordsWithoutContent: [],
        aiTokenUsage: {
          inputTokens:      aiInputTokens,
          outputTokens:     aiOutputTokens,
          estimatedCostUSD: 0,
        },
        criticalErrors: true,
        isInterrupted:  true,
      });
 
      // Set reportSentAt only after email succeeds — ensures retry on next start if email fails
      await prisma.scrapingSession.update({
        where: { id: session.id },
        data:  { reportSentAt: new Date() },
      }).catch(() => {});
 
      console.log(`[Cron] ✅ Interruption email sent for session ${session.id}`);
    } catch (emailErr) {
      console.error(`[Cron] Email failed for session ${session.id}: ${emailErr.message}`);
    }
  }
}
 
// Checks whether 7+ days have passed since the last successful scrape, and runs one if so.
// Called on startup and every 15 minutes thereafter. Skips if a session is already running,
// or if another check is mid-flight (isCheckingScraper guard).
async function checkAndRunScraperIfDue() {
  if (isCheckingScraper) {
    console.log("[Cron] Due-check already in progress — skipping this tick.");
    return;
  }
  isCheckingScraper = true;
 
  try {
    // Don't start a new run if one is already in progress (avoids double-runs from
    // a boot-check and a tick landing close together, or a long-running prior session).
    const activeSession = await prisma.scrapingSession.findFirst({
      where:  { status: "running" },
      select: { id: true, startedAt: true },
    });
    if (activeSession) {
      console.log(`[Cron] Scraper already running (session ${activeSession.id}, started ${activeSession.startedAt.toISOString()}) — skipping check.`);
      return;
    }
 
    const lastRun   = await getLastSuccessfulScrapeDate();
    const dueSinceMs = lastRun ? Date.now() - new Date(lastRun).getTime() : Infinity;
 
    if (dueSinceMs >= SCRAPE_INTERVAL_MS) {
      const daysSince = lastRun ? (dueSinceMs / (1000 * 60 * 60 * 24)).toFixed(1) : "never run before";
      console.log(`\n[Cron] ⏰ Scraper overdue (last successful run: ${lastRun ? lastRun.toISOString() : "never"}, ${daysSince} days) — running now.`);
 
      await cleanupStaleSessions();
      await runScrapingSession();
    } else {
      const hoursRemaining = ((SCRAPE_INTERVAL_MS - dueSinceMs) / (1000 * 60 * 60)).toFixed(1);
      console.log(`[Cron] Scraper not due yet — next run in ~${hoursRemaining}h.`);
    }
  } catch (err) {
    console.error(`[Cron] ❌ Due-check/session failed: ${err.message}`);
  } finally {
    isCheckingScraper = false;
  }
}
 
// Called once from src/index.js: startScrapingJobs().catch(err => console.error(err))
async function startScrapingJobs() {
  try {
    await cleanupStaleSessions();
  } catch (err) {
    console.error(`[Cron] Startup cleanup failed: ${err.message}`);
  }
 
  // Catch up immediately if the dyno booted after the weekly window was already missed
  // (mirrors wordpress.job.js's startup recovery for overdue jobs).
  await checkAndRunScraperIfDue();
 
  // Re-check every 15 minutes while the dyno is awake. Each tick is a cheap DB read
  // unless a run is actually due, so this is safe to leave running continuously.
  cron.schedule(CHECK_CRON_PATTERN, checkAndRunScraperIfDue, { scheduled: true, timezone: "UTC" });
 
  console.log(`[Cron] ✅ Scraper due-check scheduled: every 15 minutes (runs once 7+ days have passed since the last successful scrape)`);
}
 
module.exports = { startScrapingJobs, cleanupStaleSessions, checkAndRunScraperIfDue };
 