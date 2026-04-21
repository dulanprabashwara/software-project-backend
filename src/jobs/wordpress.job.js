const prisma = require("../config/prisma");
const { pushArticleToWordPress, attemptDraftSave } = require("../services/wordpress.service");

// ─── In-memory timeout registry ──────────────────────────────────────────────
// Maps jobId → Node.js timeout handle.
// Allows cancelling a timeout if a job is rescheduled or deleted.
const _timeouts = new Map();

// ─── Execute a single WordPress publish job ───────────────────────────────────

const _executeJob = async (jobId) => {
  _timeouts.delete(jobId);

  // Fetch fresh job + article + connection at fire time
  let job;
  try {
    job = await prisma.wordPressPublishJob.findUnique({
      where:   { id: jobId },
      include: { article: true, wpConnection: true },
    });
  } catch (err) {
    console.error(`[WordPress Scheduler] DB error fetching job ${jobId}:`, err.message);
    return;
  }

  if (!job) {
    console.warn(`[WordPress Scheduler] Job ${jobId} not found at fire time — skipped.`);
    return;
  }

  // Only run if still PENDING
  if (job.status !== "PENDING") {
    console.log(`[WordPress Scheduler] Job ${jobId} status is "${job.status}" — skipped.`);
    return;
  }

  // Article must exist
  if (!job.article) {
    await _cancelJob(jobId, "Article no longer exists.");
    return;
  }

  // DRAFT: cancel immediately, no retry
  if (job.article.status === "DRAFT") {
    await _cancelJob(jobId,
      "Article is DRAFT — was never published on Easy Blogger. WordPress publish skipped."
    );
    return;
  }

  // SCHEDULED: platform publish not complete yet — retry once after 3 minutes
  if (job.article.status !== "PUBLISHED") {
    const retryKey = `${jobId}_retry`;
    if (_timeouts.has(retryKey)) {
      // Already retried once — give up
      _timeouts.delete(retryKey);
      await _cancelJob(jobId,
        `Article was not PUBLISHED on Easy Blogger 3 minutes after scheduled time ` +
        `(status: "${job.article.status}"). WordPress publish cancelled to prevent orphan content.`
      );
      console.warn(`[WordPress Scheduler] ⛔ Cancelled ${jobId} after retry — platform status "${job.article.status}".`);
    } else {
      console.log(`[WordPress Scheduler] Article not PUBLISHED yet — retrying in 3 minutes.`);
      const handle = setTimeout(() => _executeJob(jobId), 3 * 60 * 1000);
      _timeouts.set(retryKey, handle);
    }
    return;
  }

  // Mark IN_PROGRESS before calling WordPress API
  try {
    await prisma.wordPressPublishJob.update({
      where: { id: jobId },
      data:  { status: "IN_PROGRESS" },
    });
  } catch {
    return; // Another process grabbed it
  }

  // Push to WordPress
  try {
    const { wpPostId, wpPostUrl } = await pushArticleToWordPress(
      job.article,
      job.wpConnection
    );

    await prisma.wordPressPublishJob.update({
      where: { id: jobId },
      data:  { status: "PUBLISHED", wpPostId, wpPostUrl, errorMsg: null, draftUrl: null },
    });

    console.log(`[WordPress Scheduler] ✅ Published "${job.article.title}" → ${wpPostUrl}`);

  } catch (publishErr) {
    const draftUrl = await attemptDraftSave(job.article, job.wpConnection);

    await prisma.wordPressPublishJob.update({
      where: { id: jobId },
      data:  { status: "FAILED", errorMsg: publishErr.message, draftUrl },
    });

    if (draftUrl) {
      console.error(`[WordPress Scheduler] ❌ "${job.article.title}" failed: ${publishErr.message}. Draft: ${draftUrl}`);
    } else {
      console.error(`[WordPress Scheduler] ❌ "${job.article.title}" failed and draft also failed: ${publishErr.message}`);
    }
  }
};

// ─── Cancel a job in DB ───────────────────────────────────────────────────────

const _cancelJob = async (jobId, reason) => {
  try {
    await prisma.wordPressPublishJob.update({
      where: { id: jobId },
      data:  { status: "CANCELLED", errorMsg: reason },
    });
  } catch (err) {
    console.error(`[WordPress Scheduler] Failed to cancel job ${jobId}:`, err.message);
  }
};

// ─── Register a future publish job ───────────────────────────────────────────

/**
 * Register a setTimeout for a WordPress publish job.
 * Called by scheduleWordPressPublish() when a PENDING job is created,
 * and on server startup for recovery.
 *
 * Zero recurring DB polls — only fires at the exact scheduled time.
 */
const registerJobTimeout = (jobId, scheduledAt) => {
  // Cancel existing timeout for this job (handles reschedule)
  if (_timeouts.has(jobId)) {
    clearTimeout(_timeouts.get(jobId));
    _timeouts.delete(jobId);
  }

  const msUntilFire = new Date(scheduledAt).getTime() - Date.now();

  if (msUntilFire <= 0) {
    // Overdue — fire immediately (server restart recovery case)
    console.log(`[WordPress Scheduler] Job ${jobId} is overdue, firing now.`);
    setImmediate(() => _executeJob(jobId));
    return;
  }

  // Node.js setTimeout max is ~24.8 days (32-bit int limit).
  // For jobs further than that, re-register when closer.
  const MAX_MS = 24 * 24 * 60 * 60 * 1000;
  if (msUntilFire > MAX_MS) {
    const handle = setTimeout(() => registerJobTimeout(jobId, scheduledAt), MAX_MS);
    _timeouts.set(jobId, handle);
    return;
  }

  const handle = setTimeout(() => _executeJob(jobId), msUntilFire);
  _timeouts.set(jobId, handle);

  console.log(`[WordPress Scheduler] Job ${jobId} registered — fires at ${new Date(scheduledAt).toLocaleString()}.`);
};

// ─── Cancel a registered timeout ─────────────────────────────────────────────

const cancelJobTimeout = (jobId) => {
  if (_timeouts.has(jobId)) {
    clearTimeout(_timeouts.get(jobId));
    _timeouts.delete(jobId);
  }
};

// ─── Startup recovery — runs ONE query, then no more polling ─────────────────

/**
 * Called once from src/index.js on server start.
 * Finds all PENDING jobs and registers their timeouts.
 * After this, the scheduler is entirely event-driven.
 */
const startWordPressJobs = async () => {
  console.log("[WordPress Scheduler] Starting — recovering pending jobs (single DB query)...");

  let pendingJobs;
  try {
    pendingJobs = await prisma.wordPressPublishJob.findMany({
      where:  { status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true, scheduledAt: true, status: true },
    });
  } catch (err) {
    console.error("[WordPress Scheduler] Failed to recover pending jobs:", err.message);
    return;
  }

  // Reset IN_PROGRESS jobs back to PENDING (interrupted by previous restart)
  const interrupted = pendingJobs.filter(j => j.status === "IN_PROGRESS");
  if (interrupted.length > 0) {
    await prisma.wordPressPublishJob.updateMany({
      where: { id: { in: interrupted.map(j => j.id) } },
      data:  { status: "PENDING" },
    });
  }

  for (const job of pendingJobs) {
    registerJobTimeout(job.id, job.scheduledAt);
  }

  console.log(
    `[WordPress Scheduler] Ready. ${pendingJobs.length} job(s) recovered. ` +
    `No recurring polls — fires only when a job is due.`
  );
};

// ─── Batch processor (used by tests and startup recovery) ────────────────────
// Not called by any timer in production — the setTimeout scheduler handles
// individual jobs via _executeJob. This function is exported so tests can
// simulate batch execution without needing to wire up setTimeout internals.

const processWordPressJobs = async () => {
  let pendingJobs;
  try {
    pendingJobs = await prisma.wordPressPublishJob.findMany({
      where: {
        status:      "PENDING",
        scheduledAt: { lte: new Date() },
      },
      include: { article: true, wpConnection: true },
    });
  } catch (err) {
    console.error("[WordPress Scheduler] Failed to fetch pending jobs:", err.message);
    return;
  }

  if (pendingJobs.length === 0) return;

  for (const job of pendingJobs) {
    if (!job.article) {
      await _cancelJob(job.id, "Article no longer exists.");
      continue;
    }

    if (job.article.status === "DRAFT") {
      await _cancelJob(job.id,
        "Article is DRAFT — was never published on Easy Blogger. WordPress publish skipped."
      );
      continue;
    }

    if (job.article.status !== "PUBLISHED") {
      const minutesPast = Math.floor((Date.now() - new Date(job.scheduledAt).getTime()) / 60000);
      if (minutesPast <= 5) continue; // within grace period — skip this run
      await _cancelJob(job.id,
        `Article was not published on Easy Blogger within 5 minutes of scheduled time ` +
        `(status: "${job.article.status}"). WordPress publish cancelled.`
      );
      continue;
    }

    try {
      await prisma.wordPressPublishJob.update({
        where: { id: job.id },
        data:  { status: "IN_PROGRESS" },
      });
    } catch {
      continue;
    }

    try {
      const { wpPostId, wpPostUrl } = await pushArticleToWordPress(job.article, job.wpConnection);
      await prisma.wordPressPublishJob.update({
        where: { id: job.id },
        data:  { status: "PUBLISHED", wpPostId, wpPostUrl, errorMsg: null, draftUrl: null },
      });
    } catch (publishErr) {
      const draftUrl = await attemptDraftSave(job.article, job.wpConnection);
      await prisma.wordPressPublishJob.update({
        where: { id: job.id },
        data:  { status: "FAILED", errorMsg: publishErr.message, draftUrl },
      });
    }
  }
};

module.exports = { startWordPressJobs, registerJobTimeout, cancelJobTimeout, processWordPressJobs };
