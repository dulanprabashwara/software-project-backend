// src/jobs/scraper.job.js
// Registers the weekly Saturday 06:00 UTC cron job.
// Includes a distributed database lock so only one process runs per week
// (relevant when multiple developers share the same NeonDB locally).

const cron  = require("node-cron");
const prisma = require("../config/prisma");
const { runScrapingSession } = require("../services/scraper.service");

// Sessions running longer than 3 hours are considered abandoned (process was killed)
const STALE_SESSION_TIMEOUT_MS = 3 * 60 * 60 * 1000;

// Window within which a running session is considered actively owned by another process
const LOCK_WINDOW_MS = 10 * 60 * 1000;

// Finds sessions stuck in "running" status for too long, marks them as canceled, and emails a partial report.
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

    await prisma.scrapingSession.update({
      where: { id: session.id },
      data: {
        status:         "canceled",
        completedAt:    new Date(),
        criticalErrors: true,
        reportData:     JSON.stringify({ canceledReason: "Process interrupted — terminal killed or server restarted" }),
      },
    }).catch((e) => console.error(`[Cron] Failed to mark session ${session.id} canceled: ${e.message}`));

    console.warn(`[Cron] Session ${session.id} marked canceled (ran for ${durationMinutes.toFixed(0)}m)`);

    try {
      const { sendCompletionNotification } = require("../services/email.service");

      await sendCompletionNotification({
        sessionId:            session.id,
        startedAt:            session.startedAt,
        completedAt:          new Date().toISOString(),
        durationMinutes:      parseFloat(durationMinutes.toFixed(2)),
        totalSources:         session.totalSources,
        totalUrlsFound:       session.successCount + session.duplicateCount + session.failureCount,
        successCount:         session.successCount,
        duplicateCount:       session.duplicateCount,
        failureCount:         session.failureCount,
        successRate:          null,
        enrichedCount:        session.enrichedCount,
        enrichmentFailed:     0,
        totalKeywordsCovered: session.keywordsCoveredCount,
        totalKeywordsEmpty:   0,
        keywordsWithContent:  [],
        keywordsWithoutContent: [],
        aiTokenUsage: {
          inputTokens:      session.aiInputTokens,
          outputTokens:     session.aiOutputTokens,
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

// Checks whether another process already started a session within the lock window.
// Returns true if this process should proceed, false if it should back off.
async function acquireSessionLock() {
  const windowStart = new Date(Date.now() - LOCK_WINDOW_MS);

  const existingSession = await prisma.scrapingSession.findFirst({
    where: {
      status:    "running",
      startedAt: { gte: windowStart },
    },
    orderBy: { startedAt: "desc" },
    select:  { id: true, startedAt: true },
  });

  if (existingSession) {
    console.log(
      `[Cron] 🔒 Session lock held by ${existingSession.id} ` +
      `(started ${existingSession.startedAt.toISOString()}). ` +
      `Another process is already running — skipping.`
    );
    return false;
  }

  return true;
}

// Registers the weekly cron job and logs when the next run will fire.
function startScrapingJobs() {
  cron.schedule(
    "0 6 * * 6",     // Every Saturday at 06:00 UTC
    async () => {
      console.log(`\n[Cron] ⏰ Weekly scraping triggered at ${new Date().toISOString()}`);

      try {
        await cleanupStaleSessions();

        const canProceed = await acquireSessionLock();
        if (!canProceed) return;

        console.log("[Cron] ✅ Lock acquired — starting session...");
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

module.exports = { startScrapingJobs, cleanupStaleSessions, acquireSessionLock };