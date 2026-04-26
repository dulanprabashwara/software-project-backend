const prisma = require("../config/prisma");
const { pushArticleToWordPress, attemptDraftSave } = require("../services/wordpress.service");

// In-memory map of jobId → setTimeout handle.
// Lets us cancel or reschedule a job without hitting the database.
const _timeouts = new Map();

// Marks a job CANCELLED in the database with an explanatory reason.
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

// Validates the article status, then pushes to WordPress.
// Returns true if the job was handled (published, failed, or cancelled), false if it should be retried later.
const _runPublish = async (jobId, article, wpConnection) => {
  if (!article) {
    await _cancelJob(jobId, "Article no longer exists.");
    return true;
  }

  if (article.status === "DRAFT") {
    await _cancelJob(jobId, "Article is DRAFT and was never published on Easy Blogger. WordPress publish skipped.");
    return true;
  }

  if (article.status !== "PUBLISHED") {
    return false; // caller decides whether to retry or cancel
  }

  try {
    await prisma.wordPressPublishJob.update({ where: { id: jobId }, data: { status: "IN_PROGRESS" } });
  } catch {
    return true; // another process grabbed it
  }

  try {
    const { wpPostId, wpPostUrl } = await pushArticleToWordPress(article, wpConnection);
    await prisma.wordPressPublishJob.update({
      where: { id: jobId },
      data:  { status: "PUBLISHED", wpPostId, wpPostUrl, errorMsg: null, draftUrl: null },
    });
    console.log(`[WordPress Scheduler] ✅ Published "${article.title}" → ${wpPostUrl}`);
  } catch (publishErr) {
    const draftUrl = await attemptDraftSave(article, wpConnection);
    await prisma.wordPressPublishJob.update({
      where: { id: jobId },
      data:  { status: "FAILED", errorMsg: publishErr.message, draftUrl },
    });
    const suffix = draftUrl ? `. Draft saved: ${draftUrl}` : " and draft save also failed.";
    console.error(`[WordPress Scheduler] ❌ "${article.title}" failed: ${publishErr.message}${suffix}`);
  }

  return true;
};

// Fires when a scheduled job's timeout elapses.
// Fetches the job fresh from the DB, validates article status, and either
// publishes to WordPress or retries once after 3 minutes if the platform
// publish hasn't completed yet.
const _executeJob = async (jobId) => {
  _timeouts.delete(jobId);

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

  if (!job)                       return console.warn(`[WordPress Scheduler] Job ${jobId} not found — skipped.`);
  if (job.status !== "PENDING")   return console.log(`[WordPress Scheduler] Job ${jobId} is "${job.status}" — skipped.`);

  const handled = await _runPublish(jobId, job.article, job.wpConnection);

  if (!handled) {
    const retryKey = `${jobId}_retry`;
    if (_timeouts.has(retryKey)) {
      _timeouts.delete(retryKey);
      await _cancelJob(jobId, `Article was not PUBLISHED 3 minutes after scheduled time (status: "${job.article.status}"). Cancelled to prevent orphan content.`);
      console.warn(`[WordPress Scheduler] ⛔ Cancelled ${jobId} after retry.`);
    } else {
      console.log(`[WordPress Scheduler] Article not PUBLISHED yet — retrying in 3 minutes.`);
      _timeouts.set(retryKey, setTimeout(() => _executeJob(jobId), 3 * 60 * 1000));
    }
  }
};

// Registers a setTimeout for a WordPress publish job.
// Called when a new scheduled job is created and on server startup to recover pending jobs.
// No recurring database polls — fires only at the exact scheduled time.
const registerJobTimeout = (jobId, scheduledAt) => {
  if (_timeouts.has(jobId)) {
    clearTimeout(_timeouts.get(jobId));
    _timeouts.delete(jobId);
  }

  const msUntilFire = new Date(scheduledAt).getTime() - Date.now();

  if (msUntilFire <= 0) {
    console.log(`[WordPress Scheduler] Job ${jobId} is overdue, firing now.`);
    setImmediate(() => _executeJob(jobId));
    return;
  }

  // Node.js setTimeout has a 32-bit ms limit (~24.8 days).
  // For jobs beyond that, re-register closer to the time.
  const MAX_MS = 24 * 24 * 60 * 60 * 1000;
  if (msUntilFire > MAX_MS) {
    _timeouts.set(jobId, setTimeout(() => registerJobTimeout(jobId, scheduledAt), MAX_MS));
    return;
  }

  _timeouts.set(jobId, setTimeout(() => _executeJob(jobId), msUntilFire));
  console.log(`[WordPress Scheduler] Job ${jobId} registered — fires at ${new Date(scheduledAt).toLocaleString()}.`);
};

// Clears the in-memory timeout for a job without touching the database.
const cancelJobTimeout = (jobId) => {
  if (_timeouts.has(jobId)) {
    clearTimeout(_timeouts.get(jobId));
    _timeouts.delete(jobId);
  }
};

// Runs once on server startup to re-register timeouts for any jobs that were
// pending when the server last shut down. Resets any IN_PROGRESS jobs back to
// PENDING since they were interrupted mid-execution.
const startWordPressJobs = async () => {
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

  console.log(`[WordPress Scheduler] Ready — ${pendingJobs.length} job(s) recovered.`);
};

// Batch processor used by tests. Not called in production — the setTimeout
// scheduler handles individual jobs via _executeJob.
const processWordPressJobs = async () => {
  let pendingJobs;
  try {
    pendingJobs = await prisma.wordPressPublishJob.findMany({
      where:   { status: "PENDING", scheduledAt: { lte: new Date() } },
      include: { article: true, wpConnection: true },
    });
  } catch (err) {
    console.error("[WordPress Scheduler] Failed to fetch pending jobs:", err.message);
    return;
  }

  if (pendingJobs.length === 0) return;

  for (const job of pendingJobs) {
    const handled = await _runPublish(job.id, job.article, job.wpConnection);

    if (!handled) {
      const minutesPast = Math.floor((Date.now() - new Date(job.scheduledAt).getTime()) / 60000);
      if (minutesPast > 5) {
        await _cancelJob(job.id, `Article was not published on Easy Blogger within 5 minutes (status: "${job.article.status}"). WordPress publish cancelled.`);
      }
    }
  }
};

module.exports = { startWordPressJobs, registerJobTimeout, cancelJobTimeout, processWordPressJobs };