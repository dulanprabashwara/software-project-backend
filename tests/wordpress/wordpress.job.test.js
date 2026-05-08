// tests/wordpress/wordpress.job.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — wordpress.job.js (cron processor) + getWordPressPublishStatus
//
// IMPORTANT — axios.post call order when article has a coverImage:
//   When publish fails and a draft save is attempted, _runPublish makes
//   4 axios.post calls total (via pushArticleToWordPress + attemptDraftSave):
//     [0] media upload inside pushArticleToWordPress
//     [1] posts/new publish    → the one that should fail
//     [2] media upload inside attemptDraftSave
//     [3] posts/new draft save → the fallback
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock.wp"));
jest.mock("axios",                   () => require("../mocks/axios.mock"));

const prisma = require("../../src/config/prisma");
const axios  = require("axios");

const { processWordPressJobs }      = require("../../src/jobs/wordpress.job");
const { getWordPressPublishStatus } = require("../../src/services/wordpress.service");

const {
  MOCK_ARTICLE,
  MOCK_WP_CONNECTION,
  MOCK_WP_POST_RESPONSE,
  MOCK_PUBLISH_JOB_PENDING,
  MOCK_PUBLISH_JOB_PUBLISHED,
  MOCK_PUBLISH_JOB_FAILED,
} = require("./fixtures");

// ─── Helpers for building job variants ───────────────────────────────────────

const publishedArticleJob = () => ({
  ...MOCK_PUBLISH_JOB_PENDING,
  article:      { ...MOCK_ARTICLE, status: "PUBLISHED" },
  wpConnection: MOCK_WP_CONNECTION,
});

const scheduledArticleJob = (minutesAgo = 2) => ({
  ...MOCK_PUBLISH_JOB_PENDING,
  scheduledAt:  new Date(Date.now() - minutesAgo * 60 * 1000),
  article:      { ...MOCK_ARTICLE, status: "SCHEDULED" },
  wpConnection: MOCK_WP_CONNECTION,
});

const overdueScheduledJob = () => scheduledArticleJob(10);

const draftArticleJob = () => ({
  ...MOCK_PUBLISH_JOB_PENDING,
  article:      { ...MOCK_ARTICLE, status: "DRAFT" },
  wpConnection: MOCK_WP_CONNECTION,
});

const deletedArticleJob = () => ({
  ...MOCK_PUBLISH_JOB_PENDING,
  article:      null,
  wpConnection: MOCK_WP_CONNECTION,
});

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLIENT_URL = "http://localhost:3000";
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 7: processWordPressJobs
// ═════════════════════════════════════════════════════════════════════════════

describe("processWordPressJobs", () => {

  // ── Basic operation ───────────────────────────────────────────────────────

  // TC-JOB-001
  test("TC-JOB-001 | does nothing when there are no pending jobs", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([]);

    await processWordPressJobs();

    expect(prisma.wordPressPublishJob.update).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // TC-JOB-002
  test("TC-JOB-002 | queries for PENDING jobs with scheduledAt <= now", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([]);

    await processWordPressJobs();

    const query = prisma.wordPressPublishJob.findMany.mock.calls[0][0];
    expect(query.where.status).toBe("PENDING");
    expect(query.where.scheduledAt).toEqual(expect.objectContaining({ lte: expect.any(Date) }));
  });

  // TC-JOB-003
  test("TC-JOB-003 | does not throw when prisma.findMany fails (graceful degradation)", async () => {
    prisma.wordPressPublishJob.findMany.mockRejectedValue(new Error("DB timeout"));
    await expect(processWordPressJobs()).resolves.toBeUndefined();
  });

  // ── Article status guard ──────────────────────────────────────────────────

  // TC-JOB-004
  test("TC-JOB-004 | skips job and does NOT call WordPress when article is still SCHEDULED within grace period", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([scheduledArticleJob(2)]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});

    await processWordPressJobs();

    expect(axios.post).not.toHaveBeenCalled();
    expect(prisma.wordPressPublishJob.update).not.toHaveBeenCalled();
  });

  // TC-JOB-005
  test("TC-JOB-005 | CANCELS job when article is still SCHEDULED past the grace period", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([overdueScheduledJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});

    await processWordPressJobs();

    expect(axios.post).not.toHaveBeenCalled();
    const updateCall = prisma.wordPressPublishJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("CANCELLED");
  });

  // TC-JOB-006
  test("TC-JOB-006 | CANCELLED job errorMsg explains platform did not publish", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([overdueScheduledJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});

    await processWordPressJobs();

    const updateCall = prisma.wordPressPublishJob.update.mock.calls[0][0];
    expect(updateCall.data.errorMsg).toMatch(/not published on Easy Blogger/i);
  });

  // TC-JOB-007
  test("TC-JOB-007 | CANCELS job immediately when article status is DRAFT", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([draftArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});

    await processWordPressJobs();

    expect(axios.post).not.toHaveBeenCalled();
    const updateCall = prisma.wordPressPublishJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("CANCELLED");
  });

  // TC-JOB-008
  test("TC-JOB-008 | CANCELS job when article record has been deleted", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([deletedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});

    await processWordPressJobs();

    expect(axios.post).not.toHaveBeenCalled();
    const updateCall = prisma.wordPressPublishJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("CANCELLED");
  });

  // TC-JOB-009
  test("TC-JOB-009 | CANCELS deleted-article job with an informative message", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([deletedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});

    await processWordPressJobs();

    const updateCall = prisma.wordPressPublishJob.update.mock.calls[0][0];
    expect(updateCall.data.errorMsg).toMatch(/no longer exists/i);
  });

  // ── Happy path — article is PUBLISHED ────────────────────────────────────

  // TC-JOB-010
  test("TC-JOB-010 | marks job IN_PROGRESS before calling WordPress when article is PUBLISHED", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    // [0] media upload, [1] posts/new publish
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: MOCK_WP_POST_RESPONSE });

    await processWordPressJobs();

    const firstUpdate = prisma.wordPressPublishJob.update.mock.calls[0][0];
    expect(firstUpdate.data.status).toBe("IN_PROGRESS");
  });

  // TC-JOB-011
  test("TC-JOB-011 | marks job PUBLISHED after successful WordPress API call", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: MOCK_WP_POST_RESPONSE });

    await processWordPressJobs();

    const secondUpdate = prisma.wordPressPublishJob.update.mock.calls[1][0];
    expect(secondUpdate.data.status).toBe("PUBLISHED");
  });

  // TC-JOB-012
  test("TC-JOB-012 | stores wpPostId and wpPostUrl on success", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: MOCK_WP_POST_RESPONSE });

    await processWordPressJobs();

    const secondUpdate = prisma.wordPressPublishJob.update.mock.calls[1][0];
    expect(secondUpdate.data.wpPostId).toBe(String(MOCK_WP_POST_RESPONSE.ID));
    expect(secondUpdate.data.wpPostUrl).toBe(MOCK_WP_POST_RESPONSE.URL);
  });

  // ── Failure path — article is PUBLISHED but WordPress API fails ───────────

  // TC-JOB-013 — full 4-call chain: media→publish(fail)→media→draft(success)
  test("TC-JOB-013 | marks job FAILED when WordPress API call throws", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    axios.post
      .mockResolvedValueOnce({ data: {} })                              // [0] media upload
      .mockRejectedValueOnce(new Error("WP API timeout"))              // [1] publish fails
      .mockResolvedValueOnce({ data: {} })                              // [2] media in attemptDraftSave
      .mockResolvedValueOnce({ data: { ID: 1, status: "draft" } });    // [3] draft saves

    await processWordPressJobs();

    const secondUpdate = prisma.wordPressPublishJob.update.mock.calls[1][0];
    expect(secondUpdate.data.status).toBe("FAILED");
  });

  // TC-JOB-014
  test("TC-JOB-014 | stores errorMsg when publish fails", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    // All calls reject — the media upload error is swallowed, publish error propagates
    axios.post.mockRejectedValue(new Error("WP API timeout"));

    await processWordPressJobs();

    const secondUpdate = prisma.wordPressPublishJob.update.mock.calls[1][0];
    expect(secondUpdate.data.errorMsg).toContain("WP API timeout");
  });

  // TC-JOB-015 — full 4-call chain: media→publish(fail)→media→draft(success)
  test("TC-JOB-015 | stores draftUrl when draft save succeeds after publish failure", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    axios.post
      .mockResolvedValueOnce({ data: {} })                              // [0] media upload
      .mockRejectedValueOnce(new Error("publish failed"))              // [1] publish fails
      .mockResolvedValueOnce({ data: {} })                              // [2] media in attemptDraftSave
      .mockResolvedValueOnce({ data: { ID: 1, status: "draft" } });    // [3] draft saves

    await processWordPressJobs();

    const secondUpdate = prisma.wordPressPublishJob.update.mock.calls[1][0];
    expect(secondUpdate.data.draftUrl).toBeDefined();
    expect(secondUpdate.data.draftUrl).not.toBeNull();
  });

  // TC-JOB-016 — full 4-call chain: media→publish(fail)→media→draft(fail)
  test("TC-JOB-016 | draftUrl is null when both publish and draft save fail", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    axios.post
      .mockResolvedValueOnce({ data: {} })                              // [0] media upload
      .mockRejectedValueOnce(new Error("publish failed"))              // [1] publish fails
      .mockResolvedValueOnce({ data: {} })                              // [2] media in attemptDraftSave
      .mockRejectedValueOnce(new Error("draft failed"));               // [3] draft fails

    await processWordPressJobs();

    const secondUpdate = prisma.wordPressPublishJob.update.mock.calls[1][0];
    expect(secondUpdate.data.draftUrl).toBeNull();
  });

  // ── Concurrency and batching ──────────────────────────────────────────────

  // TC-JOB-017
  test("TC-JOB-017 | skips job if IN_PROGRESS update throws (another instance grabbed it)", async () => {
    prisma.wordPressPublishJob.findMany.mockResolvedValue([publishedArticleJob()]);
    prisma.wordPressPublishJob.update.mockRejectedValueOnce(new Error("row locked"));

    await processWordPressJobs();

    expect(axios.post).not.toHaveBeenCalled();
  });

  // TC-JOB-018 — one ready job makes 2 axios calls (media upload + posts/new)
  test("TC-JOB-018 | processes multiple jobs with different article statuses in one run", async () => {
    const readyJob    = { ...publishedArticleJob(),  id: "job_ready" };
    const notReadyJob = { ...scheduledArticleJob(2), id: "job_wait" };
    const cancelJob   = { ...overdueScheduledJob(),  id: "job_cancel" };

    prisma.wordPressPublishJob.findMany.mockResolvedValue([readyJob, notReadyJob, cancelJob]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    // readyJob: [0] media upload, [1] posts/new publish
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: MOCK_WP_POST_RESPONSE });

    await processWordPressJobs();

    // readyJob makes 2 axios calls (media + publish); the other two jobs make none
    expect(axios.post).toHaveBeenCalledTimes(2);

    // IN_PROGRESS + PUBLISHED for readyJob = 2, CANCELLED for cancelJob = 1, nothing for notReadyJob
    expect(prisma.wordPressPublishJob.update).toHaveBeenCalledTimes(3);
  });

  // TC-JOB-019
  test("TC-JOB-019 | one job failing does not stop other jobs from processing", async () => {
    const failJob    = { ...publishedArticleJob(), id: "job_fail" };
    const successJob = { ...publishedArticleJob(), id: "job_ok" };

    prisma.wordPressPublishJob.findMany.mockResolvedValue([failJob, successJob]);
    prisma.wordPressPublishJob.update.mockResolvedValue({});
    axios.post
      .mockRejectedValueOnce(new Error("Fail"))
      .mockResolvedValueOnce({ data: MOCK_WP_POST_RESPONSE })
      .mockResolvedValueOnce({ data: MOCK_WP_POST_RESPONSE });

    await processWordPressJobs();

    // 2 IN_PROGRESS updates + 2 final updates = 4
    expect(prisma.wordPressPublishJob.update).toHaveBeenCalledTimes(4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 8: getWordPressPublishStatus
// ═════════════════════════════════════════════════════════════════════════════

describe("getWordPressPublishStatus", () => {

  // TC-STAT-001
  test("TC-STAT-001 | returns the most recent job for an article", async () => {
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(MOCK_PUBLISH_JOB_PUBLISHED);
    const result = await getWordPressPublishStatus(MOCK_ARTICLE.id, "user_abc123");
    expect(result).toMatchObject({ status: "PUBLISHED", wpPostUrl: MOCK_PUBLISH_JOB_PUBLISHED.wpPostUrl });
  });

  // TC-STAT-002
  test("TC-STAT-002 | returns null when no job exists", async () => {
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(null);
    const result = await getWordPressPublishStatus("no_article", "user_abc123");
    expect(result).toBeNull();
  });

  // TC-STAT-003
  test("TC-STAT-003 | returns draftUrl for a FAILED job", async () => {
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(MOCK_PUBLISH_JOB_FAILED);
    const result = await getWordPressPublishStatus(MOCK_ARTICLE.id, "user_abc123");
    expect(result.draftUrl).toBe(MOCK_PUBLISH_JOB_FAILED.draftUrl);
  });

  // TC-STAT-004
  test("TC-STAT-004 | CANCELLED status is returned correctly", async () => {
    const cancelledJob = {
      ...MOCK_PUBLISH_JOB_FAILED,
      status:   "CANCELLED",
      draftUrl: null,
      errorMsg: "Article was not published on Easy Blogger within 5 minutes.",
    };
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(cancelledJob);

    const result = await getWordPressPublishStatus(MOCK_ARTICLE.id, "user_abc123");

    expect(result.status).toBe("CANCELLED");
    expect(result.errorMsg).toMatch(/Easy Blogger/);
  });

  // TC-STAT-005
  test("TC-STAT-005 | queries by both articleId and userId", async () => {
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(null);
    await getWordPressPublishStatus(MOCK_ARTICLE.id, "user_abc123");
    const query = prisma.wordPressPublishJob.findFirst.mock.calls[0][0];
    expect(query.where.articleId).toBe(MOCK_ARTICLE.id);
    expect(query.where.userId).toBe("user_abc123");
  });

  // TC-STAT-006
  test("TC-STAT-006 | orders by createdAt descending to get the latest job", async () => {
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(null);
    await getWordPressPublishStatus(MOCK_ARTICLE.id, "user_abc123");
    const query = prisma.wordPressPublishJob.findFirst.mock.calls[0][0];
    expect(query.orderBy).toEqual({ createdAt: "desc" });
  });
});