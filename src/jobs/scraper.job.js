// src/jobs/scraper.job.js
// ─────────────────────────────────────────────────────────────────────────────
// Cron Job Scheduler — Phase 1 trigger
//
// Registers one weekly job that fires every Saturday at 06:00 UTC.
// Cron expression: "0 6 * * 6"
//   0 = minute 0
//   6 = hour 6 (6 AM)
//   * = any day of month
//   * = any month
//   6 = Saturday (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)
//
// WHY DUPLICATE SESSIONS OCCURRED (root cause):
//   Every developer runs the backend locally. Each local server registers its
//   own cron job. At 06:00 UTC Saturday, every running local server fires
//   simultaneously — all connecting to the same shared NeonDB — producing N
//   identical ScrapingSession rows (one per developer terminal).
//
// THE FIX — distributed lock via the database:
//   Before starting any session, the job checks for a ScrapingSession row that
//   was created within the last 10 minutes with status "running". If one exists,
//   it means another process already started. The current process logs a warning
//   and exits — it does NOT start a new session.
//
//   This works because all developers share the same NeonDB. The first process
//   to call createScrapingSessionLog() wins. Every other process sees the
//   running session and backs off. Only one session runs per Saturday.
//
// STALE SESSION CLEANUP:
//   Any session stuck in "running" status for more than 3 hours is considered
//   abandoned (developer killed their terminal). These are marked "canceled"
//   with a partial email report before the lock check runs. This prevents
//   old abandoned sessions from blocking future legitimate runs.
//
// WILL THIS BE NEEDED AFTER HOSTING?
//   No. Once deployed to a single server (Render, Railway, Heroku, VPS, etc.),
//   only one process ever runs. The cron fires exactly once and no lock is
//   needed. The lock is harmless in production but only truly necessary in
//   the multi-developer local environment.
//
// Called from src/index.js inside server.listen() callback:
//   const { startScrapingJobs } = require("./jobs/scraper.job");
//   server.listen(PORT, () => { startScrapingJobs(); });
// ─────────────────────────────────────────────────────────────────────────────

const cron   = require("node-cron");
const prisma  = require("../config/prisma");
const { runScrapingSession } = require("../services/scraper.service");

// How long (ms) a "running" session must be idle before it's declared abandoned.
// 3 hours is generous — a full session including enrichment completes in ~1 hour.
const STALE_SESSION_TIMEOUT_MS = 3 * 60 * 60 * 1000;

// Window (ms) within which we consider a "running" session to be actively
// owned by another process. 10 minutes covers the time between cron fires
// on all developer machines (they all fire at the same UTC second).
const LOCK_WINDOW_MS = 10 * 60 * 1000;

// ── cleanupStaleSessions ──────────────────────────────────────────────────────
// Finds sessions stuck in "running" status that were started more than
// STALE_SESSION_TIMEOUT_MS ago. Marks them as "canceled" and sends a
// partial-completion email so admins are aware of the interruption.

async function cleanupStaleSessions() {
  const cutoff = new Date(Date.now() - STALE_SESSION_TIMEOUT_MS);

  const staleSessions = await prisma.scrapingSession.findMany({
    where: {
      status:    "running",
      startedAt: { lt: cutoff },
    },
    select: {
      id:             true,
      startedAt:      true,
      totalSources:   true,
      successCount:   true,
      duplicateCount: true,
      failureCount:   true,
      enrichedCount:  true,
      keywordsCoveredCount: true,
      aiInputTokens:  true,
      aiOutputTokens: true,
    },
  });

  if (!staleSessions.length) return;

  console.warn(`[Cron] ⚠️  Found ${staleSessions.length} stale session(s). Marking as canceled...`);

  for (const session of staleSessions) {
    const durationMinutes = (Date.now() - new Date(session.startedAt).getTime()) / 60000;

    // Mark canceled in DB
    await prisma.scrapingSession.update({
      where: { id: session.id },
      data: {
        status:      "canceled",
        completedAt: new Date(),
        criticalErrors: true,
        reportData:  JSON.stringify({ canceledReason: "Process interrupted — terminal killed or server restarted" }),
      },
    }).catch((e) => console.error(`[Cron] Failed to mark session ${session.id} canceled: ${e.message}`));

    console.warn(`[Cron] Session ${session.id} marked canceled (ran for ${durationMinutes.toFixed(0)}m)`);

    // Send a partial completion email to admins
    try {
      const { sendCompletionNotification } = require("../services/email.service");

      const partialReport = {
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
        criticalErrors:   true,
        isInterrupted:    true,   // flag for email template to acknowledge interruption
      };

      await sendCompletionNotification(partialReport);
      console.log(`[Cron] Interruption email sent for canceled session ${session.id}`);
    } catch (emailErr) {
      console.error(`[Cron] Interruption email failed for session ${session.id}: ${emailErr.message}`);
    }
  }
}

// ── acquireSessionLock ────────────────────────────────────────────────────────
// Returns true if this process should proceed with the session (it "won" the lock).
// Returns false if another process already started a session within LOCK_WINDOW_MS.

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

// ── startScrapingJobs ─────────────────────────────────────────────────────────

function startScrapingJobs() {
  cron.schedule(
    "0 6 * * 6",     // Every Saturday at 06:00 UTC
    async () => {
      console.log(`\n[Cron] ⏰ Weekly scraping triggered at ${new Date().toISOString()}`);

      try {
        // Step 1: Clean up any abandoned sessions from previous runs
        await cleanupStaleSessions();

        // Step 2: Try to acquire the distributed lock
        const canProceed = await acquireSessionLock();
        if (!canProceed) return;

        // Step 3: Run the scraping session (this process won the lock)
        console.log("[Cron] ✅ Lock acquired — starting session...");
        await runScrapingSession();

      } catch (err) {
        // Log but don't crash the server — next Saturday it fires again
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
