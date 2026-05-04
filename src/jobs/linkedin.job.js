const prisma = require("../config/prisma");
const { pushArticleToLinkedIn } = require("../services/linkedin.service");

// In-memory map of jobId → setTimeout handle.
const _timeouts = new Map();

// Marks a job CANCELLED in the database.
const _cancelJob = async (jobId, reason) => {
  try {
    await prisma.linkedInPublishJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", errorMsg: reason },
    });
  } catch (err) {
    console.error(`[LinkedIn Scheduler] Failed to cancel job ${jobId}:`, err.message);
  }
};

/**
 * Validates the article status, then pushes to LinkedIn.
 */
const _runPublish = async (jobId, article, liConnection, caption) => {
  if (!article) {
    await _cancelJob(jobId, "Article no longer exists.");
    return true;
  }

  if (article.status === "DRAFT") {
    await _cancelJob(jobId, "Article is DRAFT. LinkedIn publish skipped.");
    return true;
  }

  if (article.status !== "PUBLISHED") {
    return false; // Not ready yet, retry later
  }

  try {
    await prisma.linkedInPublishJob.update({ where: { id: jobId }, data: { status: "IN_PROGRESS" } });
  } catch {
    return true; // Already handled by another process
  }

  try {
    const job = await prisma.linkedInPublishJob.findUnique({ where: { id: jobId } });
    const { liPostId, liPostUrl } = await pushArticleToLinkedIn(article, liConnection, caption, job);
    await prisma.linkedInPublishJob.update({
      where: { id: jobId },
      data: { status: "PUBLISHED", liPostId, liPostUrl, errorMsg: null },
    });
    console.log(`[LinkedIn Scheduler] ✅ Published "${article.title}" → ${liPostUrl}`);
  } catch (err) {
    await prisma.linkedInPublishJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMsg: err.message },
    });
    console.error(`[LinkedIn Scheduler] ❌ "${article.title}" failed: ${err.message}`);
  }

  return true;
};

/**
 * Fires when a scheduled job's timeout elapses.
 */
const _executeJob = async (jobId) => {
  _timeouts.delete(jobId);

  let job;
  try {
    job = await prisma.linkedInPublishJob.findUnique({
      where: { id: jobId },
      include: { article: true, liConnection: true },
    });
  } catch (err) {
    console.error(`[LinkedIn Scheduler] DB error fetching job ${jobId}:`, err.message);
    return;
  }

  if (!job) return console.warn(`[LinkedIn Scheduler] Job ${jobId} not found.`);
  if (job.status !== "PENDING") return;

  const handled = await _runPublish(jobId, job.article, job.liConnection, job.caption);

  if (!handled) {
    // Retry once after 3 minutes
    const retryKey = `${jobId}_retry`;
    if (_timeouts.has(retryKey)) {
      _timeouts.delete(retryKey);
      await _cancelJob(jobId, "Article was not PUBLISHED 3 minutes after scheduled time.");
    } else {
      console.log(`[LinkedIn Scheduler] Article not PUBLISHED yet — retrying in 3 minutes.`);
      _timeouts.set(retryKey, setTimeout(() => _executeJob(jobId), 3 * 60 * 1000));
    }
  }
};

const registerLinkedInJob = (jobId, scheduledAt) => {
  if (_timeouts.has(jobId)) {
    clearTimeout(_timeouts.get(jobId));
    _timeouts.delete(jobId);
  }

  const msUntilFire = new Date(scheduledAt).getTime() - Date.now();

  if (msUntilFire <= 0) {
    setImmediate(() => _executeJob(jobId));
    return;
  }

  const MAX_MS = 24 * 24 * 60 * 60 * 1000;
  if (msUntilFire > MAX_MS) {
    _timeouts.set(jobId, setTimeout(() => registerLinkedInJob(jobId, scheduledAt), MAX_MS));
    return;
  }

  _timeouts.set(jobId, setTimeout(() => _executeJob(jobId), msUntilFire));
};

const cancelLinkedInJob = (jobId) => {
  if (_timeouts.has(jobId)) {
    clearTimeout(_timeouts.get(jobId));
    _timeouts.delete(jobId);
  }
};

const startLinkedInJobs = async () => {
  try {
    const pendingJobs = await prisma.linkedInPublishJob.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true, scheduledAt: true, status: true },
    });

    const interrupted = pendingJobs.filter(j => j.status === "IN_PROGRESS");
    if (interrupted.length > 0) {
      await prisma.linkedInPublishJob.updateMany({
        where: { id: { in: interrupted.map(j => j.id) } },
        data: { status: "PENDING" },
      });
    }

    for (const job of pendingJobs) {
      registerLinkedInJob(job.id, job.scheduledAt);
    }

    console.log(`[LinkedIn Scheduler] Ready — ${pendingJobs.length} job(s) recovered.`);
  } catch (err) {
    console.error("[LinkedIn Scheduler] Failed to recover pending jobs:", err.message);
  }
};

module.exports = { startLinkedInJobs, registerLinkedInJob, cancelLinkedInJob };
