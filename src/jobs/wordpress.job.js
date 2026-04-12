const cron = require("node-cron");
const prisma = require("../config/prisma");
const { pushArticleToWordPress, attemptDraftSave } = require("../services/wordpress.service");

// ─── Configuration ────────────────────────────────────────────────────────────

// How many minutes after the scheduled time we still wait for the platform
// to publish the article before giving up and cancelling the WordPress job.
//
// Why this exists:
//   The platform's own scheduler and this WordPress cron both run at the same
//   scheduled time. If the platform publish takes a few seconds longer (common),
//   the article might still be SCHEDULED when this cron fires.
//   We give it a small window rather than cancelling immediately.
//
// Example: article scheduled for 6:00 PM, GRACE_PERIOD_MINUTES = 5.
//   6:00 PM tick → article is SCHEDULED → skip (platform may still be publishing)
//   6:01 PM tick → article is PUBLISHED → proceed with WordPress ✅
//   6:06 PM tick → still SCHEDULED     → platform failed → CANCEL WP job ⛔
//
const GRACE_PERIOD_MINUTES = 5;

// ─── Core Job Processor ───────────────────────────────────────────────────────

/**
 * processWordPressJobs
 *
 * Runs every minute via cron. Finds all PENDING WordPress publish jobs
 * whose scheduled time has passed and handles them.
 *
 * Decision logic per job:
 *
 *   article.status === "PUBLISHED"
 *     → push to WordPress now (the canonical version exists on our platform)
 *
 *   article.status === "SCHEDULED" AND within grace period
 *     → skip this tick, retry next minute (platform publish may be in progress)
 *
 *   article.status === "SCHEDULED" AND past grace period
 *     → CANCEL the WordPress job (platform publish failed)
 *
 *   article.status === "DRAFT" or article deleted
 *     → CANCEL immediately (article was never published on our platform)
 *
 * This ensures WordPress NEVER receives content that isn't live on our platform,
 * preventing orphan articles with no canonical source.
 */
const processWordPressJobs = async () => {
  let pendingJobs;
  try {
    pendingJobs = await prisma.wordPressPublishJob.findMany({
      where: {
        status:      "PENDING",
        scheduledAt: { lte: new Date() },
      },
      include: {
        article:      true,
        wpConnection: true,
      },
    });
  } catch (err) {
    console.error("[WordPress Job] Failed to fetch pending jobs:", err.message);
    return; // Graceful: don't crash the process if DB is temporarily unreachable
  }

  if (pendingJobs.length === 0) return;

  console.log(`[WordPress Job] Processing ${pendingJobs.length} due job(s).`);

  for (const job of pendingJobs) {

    // ── GUARD 1: Article was deleted after the job was created ──────────────
    if (!job.article) {
      await _cancelJob(
        job.id,
        "Article no longer exists in the database. WordPress publish cancelled."
      );
      continue;
    }

    // ── GUARD 2: Article status check ────────────────────────────────────────
    //
    // We only push to WordPress if the article is PUBLISHED on our platform.
    //
    // DRAFT   → cancel immediately. A DRAFT was never on any publish schedule;
    //           it will never become PUBLISHED automatically, so there is nothing
    //           to wait for. No grace period applies.
    //
    // SCHEDULED (not yet PUBLISHED) → apply grace period. The platform's own
    //           scheduler and this cron fire at the same second. The platform
    //           publish may still be in-flight. Give it a few minutes before
    //           concluding it failed.
    //
    if (job.article.status === "DRAFT") {
      await _cancelJob(
        job.id,
        "Cancelled: article is in DRAFT status and was never published on " +
        "Easy Blogger. WordPress publish skipped to prevent orphan content."
      );
      console.warn(
        `[WordPress Job] ⛔ Cancelled WP publish for "${job.article.title}" — article is DRAFT.`
      );
      continue;
    }

    if (job.article.status !== "PUBLISHED") {
      // Status is SCHEDULED (or any other non-PUBLISHED, non-DRAFT state).
      // Apply grace period before concluding the platform publish failed.
      const minutesPastSchedule = _minutesSince(job.scheduledAt);

      if (minutesPastSchedule <= GRACE_PERIOD_MINUTES) {
        // Platform publish may still be running. Come back next minute.
        console.log(
          `[WordPress Job] Article "${job.article.title}" not PUBLISHED yet ` +
          `(${minutesPastSchedule}m past schedule, grace=${GRACE_PERIOD_MINUTES}m). ` +
          `Will retry.`
        );
        continue;
      }

      // Past the grace period. The platform publish failed.
      await _cancelJob(
        job.id,
        `Cancelled: article was not published on Easy Blogger within ` +
        `${GRACE_PERIOD_MINUTES} minutes of the scheduled time. ` +
        `Platform status at cancellation: "${job.article.status}". ` +
        `WordPress publish skipped to prevent orphan content.`
      );
      console.warn(
        `[WordPress Job] ⛔ Cancelled WP publish for "${job.article.title}" — ` +
        `platform status is still "${job.article.status}" after grace period.`
      );
      continue;
    }

    // ── Article is PUBLISHED on platform — safe to push to WordPress ─────────

    // Mark IN_PROGRESS before the API call to prevent double-processing
    // if this cron tick overlaps with a slow WordPress response.
    try {
      await prisma.wordPressPublishJob.update({
        where: { id: job.id },
        data:  { status: "IN_PROGRESS" },
      });
    } catch {
      // Another cron instance already grabbed this job. Skip.
      continue;
    }

    try {
      const { wpPostId, wpPostUrl } = await pushArticleToWordPress(
        job.article,
        job.wpConnection
      );

      await prisma.wordPressPublishJob.update({
        where: { id: job.id },
        data: {
          status:    "PUBLISHED",
          wpPostId,
          wpPostUrl,
          errorMsg:  null,
          draftUrl:  null,
        },
      });

      console.log(
        `[WordPress Job] ✅ Published "${job.article.title}" → ${wpPostUrl}`
      );

    } catch (publishErr) {
      // WordPress API call failed — attempt draft save as fallback
      const draftUrl = await attemptDraftSave(job.article, job.wpConnection);

      await prisma.wordPressPublishJob.update({
        where: { id: job.id },
        data: {
          status:   "FAILED",
          errorMsg: publishErr.message,
          draftUrl,
        },
      });

      if (draftUrl) {
        console.error(
          `[WordPress Job] ❌ Publish failed for "${job.article.title}": ` +
          `${publishErr.message}. Draft saved: ${draftUrl}`
        );
      } else {
        console.error(
          `[WordPress Job] ❌ Publish failed and draft also failed for ` +
          `"${job.article.title}": ${publishErr.message}`
        );
      }
    }
  }
};

// ─── Private Helpers ──────────────────────────────────────────────────────────

const _cancelJob = async (jobId, reason) => {
  try {
    await prisma.wordPressPublishJob.update({
      where: { id: jobId },
      data: {
        status:   "CANCELLED",
        errorMsg: reason,
      },
    });
  } catch (err) {
    console.error(`[WordPress Job] Failed to cancel job ${jobId}:`, err.message);
  }
};

const _minutesSince = (date) =>
  Math.floor((Date.now() - new Date(date).getTime()) / 60000);

// ─── Start ────────────────────────────────────────────────────────────────────

const startWordPressJobs = () => {
  cron.schedule("* * * * *", async () => {
    await processWordPressJobs();
  });
  console.log(
    `[WordPress Job] Started (every minute, grace period: ${GRACE_PERIOD_MINUTES}m).`
  );
};

module.exports = { startWordPressJobs, processWordPressJobs };
