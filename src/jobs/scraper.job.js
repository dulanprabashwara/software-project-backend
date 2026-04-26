// src/jobs/scraper.job.js
// Registers the weekly Saturday 06:00 UTC cron job.
// Also cleans up any sessions left in "running" state from a previous crashed/killed process.

const cron  = require("node-cron");
const prisma = require("../config/prisma");
const { runScrapingSession } = require("../services/scraper.service");

// Sessions running longer than 3 hours are considered abandoned (process was killed or server crashed).
// A full session including enrichment normally completes in under 1 hour.
const STALE_SESSION_TIMEOUT_MS = 3 * 60 * 60 * 1000;

// Finds sessions stuck in "running" status for too long, marks them as canceled, and emails a partial report.
// Called both at server startup and before each cron run to catch sessions left by any previous crash.

async function cleanupStaleSessions() {
  const cutoff = new Date(Date.now() - STALE_SESSION_TIMEOUT_MS);

  const staleSessions = await prisma.scrapingSession.findMany({
    where: {
      status:    "running",
      startedAt: { lt: cutoff },
    },
    select: {
      id:                  true,
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

  if (!staleSessions.length) return;

  console.warn(`[Cron] ⚠️  Found ${staleSessions.length} stale session(s). Marking as canceled...`);

  for (const session of staleSessions) {
    const durationMinutes = (Date.now() - new Date(session.startedAt).getTime()) / 60000;

   
    // Derive the real counts from ScrapedArticle rows tagged with this sessionId 
    let successCount   = session.successCount   || 0;
    let duplicateCount = session.duplicateCount || 0;
    let failureCount   = session.failureCount   || 0;
    let enrichedCount  = session.enrichedCount  || 0;

    const sessionHasNoStats = successCount === 0 && duplicateCount === 0 && failureCount === 0;

    if (sessionHasNoStats) {
      try {
        // Count articles actually saved before the kill
        const savedArticles = await prisma.scrapedArticle.count({
          where: { sessionId: session.id },
        });
        // Count how many were enriched (have a non-null summary)
        const enrichedArticles = await prisma.scrapedArticle.count({
          where: { sessionId: session.id, summary: { not: null } },
        });

        successCount  = savedArticles;
        enrichedCount = enrichedArticles;

        console.log(
          `[Cron] Session ${session.id} — recovered stats from ScrapedArticle: ` +
          `${savedArticles} saved, ${enrichedArticles} enriched`
        );

        // Write recovered stats back to the session row so future reads are correct
        await prisma.scrapingSession.update({
          where: { id: session.id },
          data: {
            successCount:  savedArticles,
            enrichedCount: enrichedArticles,
            totalUrlsFound: savedArticles,
          },
        }).catch((e) => console.error(`[Cron] Failed to write recovered stats for ${session.id}: ${e.message}`));

      } catch (e) {
        console.error(`[Cron] Failed to recover stats for session ${session.id}: ${e.message}`);
      }
    }

    await prisma.scrapingSession.update({
      where: { id: session.id },
      data: {
        status:         "canceled",
        completedAt:    new Date(),
        criticalErrors: true,
        reportData:     JSON.stringify({ canceledReason: "Process interrupted — server crashed or was restarted" }),
      },
    }).catch((e) => console.error(`[Cron] Failed to mark session ${session.id} canceled: ${e.message}`));

    console.warn(`[Cron] Session ${session.id} marked canceled (ran for ${durationMinutes.toFixed(0)}m)`);

    try {
      const { sendCompletionNotification } = require("../services/email.service");

      const totalUrlsFound = successCount + duplicateCount + failureCount;
      const attempted      = successCount + failureCount;

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
        successRate:          attempted > 0 ? parseFloat(((successCount / attempted) * 100).toFixed(2)) : null,
        enrichedCount,
        enrichmentFailed:     0,
        totalKeywordsCovered: session.keywordsCoveredCount || 0,
        totalKeywordsEmpty:   0,
        keywordsWithContent:  [],
        keywordsWithoutContent: [],
        aiTokenUsage: {
          inputTokens:      session.aiInputTokens  || 0,
          outputTokens:     session.aiOutputTokens || 0,
          estimatedCostUSD: 0,
        },
        criticalErrors: true,
        isInterrupted:  true,
      });
      console.log(`[Cron] Interruption email sent for canceled session ${session.id}`);
    } catch (emailErr) {
      console.error(`[Cron] Interruption email failed for session ${session.id}: ${emailErr.message}`);
    }
  }
}

// Registers the weekly cron job and runs startup cleanup.
// startScrapingJobs() is called once from src/index.js inside server.listen().
// It is async — the caller must handle the returned promise:
//   server.listen(PORT, () => { startScrapingJobs().catch(err => console.error(err)); })
async function startScrapingJobs() {
  // Clean up any sessions left running from a previous server crash or kill.
  // This runs at every server start so a crash on any day is recovered promptly,
  // not just next Saturday when the cron would fire again.
  try {
    await cleanupStaleSessions();
  } catch (err) {
    console.error(`[Cron] Startup stale session cleanup failed: ${err.message}`);
  }

  cron.schedule(
    "0 6 * * 6",     // Every Saturday at 06:00 UTC
    async () => {
      console.log(`\n[Cron] ⏰ Weekly scraping triggered at ${new Date().toISOString()}`);

      try {
        // Clean up again before starting — catches any session that got stuck since server start
        await cleanupStaleSessions();
        await runScrapingSession();

      } catch (err) {
        console.error(`[Cron] ❌ Session failed: ${err.message}`);
      }
    },
    {
      scheduled: true,
      timezone:  "UTC",
    }
  );

  console.log("[Cron] ✅ Weekly scraping scheduled: Every Saturday at 06:00 UTC");
  console.log(`[Cron]    Next run: ${getNextSaturdayUTC()}`);
}

// Returns the UTC timestamp of the next Saturday at 06:00.
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