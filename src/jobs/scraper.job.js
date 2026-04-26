// src/jobs/scraper.job.js
// Weekly cron scheduler + stale session cleanup.
//
// Two types of abandoned sessions are handled:
//   "canceled" + reportSentAt=null — signal was caught, DB updated, email not yet sent
//   "running"  + older than 3h    — process was force-killed (SIGKILL), no handler ran

const cron  = require("node-cron");
const prisma = require("../config/prisma");
const { runScrapingSession } = require("../services/scraper.service");

const STALE_SESSION_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours — max time a real session runs

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

// Finds and resolves all abandoned sessions — canceled ones with no email sent yet,
// and running ones older than 3 hours (force-killed with no signal handler).
async function cleanupStaleSessions() {
  const staleRunningCutoff = new Date(Date.now() - STALE_SESSION_TIMEOUT_MS);

  // Fetch both types of abandoned sessions in one query using OR
  const abandonedSessions = await prisma.scrapingSession.findMany({
    where: {
      reportSentAt: null,
      OR: [
        // Signal was caught → DB already says "canceled" but email never sent
        { status: "canceled" },
        // Force-killed (SIGKILL) → stayed "running", no handler fired
        { status: "running", startedAt: { lt: staleRunningCutoff } },
      ],
    },
    select: {
      id:                  true,
      status:              true,
      startedAt:           true,
      totalSources:        true,
      successCount:        true,
      duplicateCount:      true,
      failureCount:        true,
      enrichedCount:       true,
      keywordsCoveredCount: true,
      aiInputTokens:       true,
      aiOutputTokens:      true,
    },
  });

  if (!abandonedSessions.length) return;

  console.warn(`[Cron] ⚠️  Found ${abandonedSessions.length} abandoned session(s). Processing...`);

  for (const session of abandonedSessions) {
    const durationMinutes = (Date.now() - new Date(session.startedAt).getTime()) / 60000;

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

    // Write final stats and mark canceled (handles both "canceled" and stuck "running" sessions)
    await prisma.scrapingSession.update({
      where: { id: session.id },
      data: {
        status:               "canceled",
        completedAt:          session.status === "canceled" ? undefined : new Date(),
        criticalErrors:       true,
        totalUrlsFound,
        successCount,
        duplicateCount,
        failureCount,
        enrichedCount,
        enrichmentFailedCount: enrichmentFailed,
        successRate,
        durationMinutes:      parseFloat(durationMinutes.toFixed(2)),
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

// Called once from src/index.js: startScrapingJobs().catch(err => console.error(err))
async function startScrapingJobs() {
  try {
    await cleanupStaleSessions();
  } catch (err) {
    console.error(`[Cron] Startup cleanup failed: ${err.message}`);
  }

  cron.schedule(
    "0 6 * * 6",
    async () => {
      console.log(`\n[Cron] ⏰ Weekly scraping triggered at ${new Date().toISOString()}`);
      try {
        await cleanupStaleSessions();
        await runScrapingSession();
      } catch (err) {
        console.error(`[Cron] ❌ Session failed: ${err.message}`);
      }
    },
    { scheduled: true, timezone: "UTC" }
  );

  console.log("[Cron] ✅ Weekly scraping scheduled: Every Saturday at 06:00 UTC");
  console.log(`[Cron]    Next run: ${getNextSaturdayUTC()}`);
}

function getNextSaturdayUTC() {
  const now  = new Date();
  const day  = now.getUTCDay();
  const diff = (6 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + diff);
  next.setUTCHours(6, 0, 0, 0);
  return next.toUTCString();
}

module.exports = { startScrapingJobs, cleanupStaleSessions };