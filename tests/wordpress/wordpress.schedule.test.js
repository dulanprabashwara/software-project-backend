// tests/wordpress/wordpress.schedule.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — scheduleWordPressPublish
// This is the main entry point called by the controller.
// Tests cover: immediate publish (success + all failure paths),
//              scheduled publish, input validation, and edge cases.
//
// IMPORTANT — axios.post call order when article has a coverImage:
//   The full failure path (publish fails → draft attempted) makes 4 axios.post calls:
//     [0] media upload inside pushArticleToWordPress
//     [1] posts/new → publish (this is the one that should fail)
//     [2] media upload inside attemptDraftSave
//     [3] posts/new → draft save
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock.wp"));
jest.mock("axios",                   () => require("../mocks/axios.mock"));
jest.mock("../../src/jobs/wordpress.job", () => ({
  registerJobTimeout: jest.fn(),
  cancelJobTimeout:   jest.fn(),
}));

const prisma = require("../../src/config/prisma");
const axios  = require("axios");

const { scheduleWordPressPublish } = require("../../src/services/wordpress.service");

const {
  MOCK_USER,
  MOCK_ARTICLE,
  MOCK_WP_CONNECTION,
  MOCK_WP_POST_RESPONSE,
  MOCK_PUBLISH_JOB_PENDING,
  MOCK_PUBLISH_JOB_PUBLISHED,
} = require("./fixtures");

const MOCK_ARTICLE_OTHER_AUTHOR = {
  ...MOCK_ARTICLE,
  id:       "article_other001",
  authorId: "user_different999",
};

const FUTURE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours from now

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLIENT_URL = "http://localhost:3000";
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 6A: Immediate Publish — Success Path
// ═════════════════════════════════════════════════════════════════════════════

describe("scheduleWordPressPublish — immediate publish success", () => {

  beforeEach(() => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE);
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION);
    // [0] media upload (returns no media[] → null → fallback URL used)
    // [1] posts/new publish → succeeds
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: MOCK_WP_POST_RESPONSE });
    prisma.wordPressPublishJob.create.mockResolvedValue(MOCK_PUBLISH_JOB_PUBLISHED);
  });

  // TC-SCHED-001
  test("TC-SCHED-001 | returns success=true for immediate publish", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.success).toBe(true);
  });

  // TC-SCHED-002
  test("TC-SCHED-002 | returns wpPostUrl in result", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.wpPostUrl).toBe(MOCK_WP_POST_RESPONSE.URL);
  });

  // TC-SCHED-003
  test("TC-SCHED-003 | returns wpPostId in result", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.wpPostId).toBe(String(MOCK_WP_POST_RESPONSE.ID));
  });

  // TC-SCHED-004
  test("TC-SCHED-004 | creates a WordPressPublishJob with status PUBLISHED", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    expect(prisma.wordPressPublishJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PUBLISHED" }),
      })
    );
  });

  // TC-SCHED-005
  test("TC-SCHED-005 | job record contains the correct articleId and userId", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(jobData.articleId).toBe(MOCK_ARTICLE.id);
    expect(jobData.userId).toBe(MOCK_USER.id);
  });

  // TC-SCHED-006
  test("TC-SCHED-006 | job record stores wpPostId and wpPostUrl", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(jobData.wpPostId).toBe(String(MOCK_WP_POST_RESPONSE.ID));
    expect(jobData.wpPostUrl).toBe(MOCK_WP_POST_RESPONSE.URL);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 6B: Immediate Publish — Failure: publish fails, draft saves OK
// ═════════════════════════════════════════════════════════════════════════════

describe("scheduleWordPressPublish — publish fails, draft saves successfully", () => {

  const DRAFT_URL = "https://wordpress.com/posts/emmablog.wordpress.com";

  beforeEach(() => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE);
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.wordPressPublishJob.create.mockResolvedValue({});

    // Full 4-call chain when coverImage is an https URL:
    // [0] media upload inside pushArticleToWordPress  → succeeds (ignored, returns null URL)
    // [1] posts/new publish                           → FAILS
    // [2] media upload inside attemptDraftSave        → succeeds (ignored, returns null URL)
    // [3] posts/new draft save                        → SUCCEEDS
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({ response: { data: { message: "Server error" } } })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { ID: 999, status: "draft" } });
  });

  // TC-SCHED-007
  test("TC-SCHED-007 | returns success=false", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.success).toBe(false);
  });

  // TC-SCHED-008
  test("TC-SCHED-008 | returns draftUrl when draft save succeeds", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.draftUrl).toBe(DRAFT_URL);
  });

  // TC-SCHED-009
  test("TC-SCHED-009 | failureReason is publish (not both)", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.failureReason).toBe("publish");
  });

  // TC-SCHED-010
  test("TC-SCHED-010 | creates a FAILED job with draftUrl stored", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(jobData.status).toBe("FAILED");
    expect(jobData.draftUrl).toBe(DRAFT_URL);
  });

  // TC-SCHED-011
  test("TC-SCHED-011 | FAILED job stores the original publish error message", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(jobData.errorMsg).toBeDefined();
    expect(jobData.errorMsg.length).toBeGreaterThan(0);
  });

  // TC-SCHED-012 — draft save is the 4th call (index 3)
  test("TC-SCHED-012 | draft save uses status=draft in its POST body", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    const [, draftBody] = axios.post.mock.calls[3];
    expect(draftBody.status).toBe("draft");
  });

  // TC-SCHED-013 — draft save is the 4th call (index 3)
  test("TC-SCHED-013 | draft save includes article content", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    const [, draftBody] = axios.post.mock.calls[3];
    expect(draftBody.content).toContain(MOCK_ARTICLE.content);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 6C: Immediate Publish — Both publish AND draft fail
// ═════════════════════════════════════════════════════════════════════════════

describe("scheduleWordPressPublish — both publish and draft save fail", () => {

  beforeEach(() => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE);
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.wordPressPublishJob.create.mockResolvedValue({});

    // Full 4-call chain — both the publish and the draft save fail:
    // [0] media upload inside pushArticleToWordPress  → succeeds (ignored)
    // [1] posts/new publish                           → FAILS
    // [2] media upload inside attemptDraftSave        → succeeds (ignored)
    // [3] posts/new draft save                        → FAILS
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({ response: { data: { message: "Publish error" } } })
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error("Draft save network error"));
  });

  // TC-SCHED-014
  test("TC-SCHED-014 | returns success=false", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.success).toBe(false);
  });

  // TC-SCHED-015
  test("TC-SCHED-015 | draftUrl is null when draft save also fails", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.draftUrl).toBeNull();
  });

  // TC-SCHED-016
  test("TC-SCHED-016 | failureReason is both", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(result.failureReason).toBe("both");
  });

  // TC-SCHED-017
  test("TC-SCHED-017 | FAILED job is still created even when draft also fails", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);
    expect(prisma.wordPressPublishJob.create).toHaveBeenCalledTimes(1);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(jobData.status).toBe("FAILED");
  });

  // TC-SCHED-018
  test("TC-SCHED-018 | FAILED job draftUrl is null in database", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(jobData.draftUrl).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 6D: Scheduled Publish (future time)
// ═════════════════════════════════════════════════════════════════════════════

describe("scheduleWordPressPublish — scheduled for a future time", () => {

  beforeEach(() => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE);
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(null);
    prisma.wordPressPublishJob.create.mockResolvedValue({
      ...MOCK_PUBLISH_JOB_PENDING,
      scheduledAt: FUTURE_DATE,
    });
  });

  // TC-SCHED-019
  test("TC-SCHED-019 | returns success=true for scheduled publish", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, FUTURE_DATE);
    expect(result.success).toBe(true);
  });

  // TC-SCHED-020
  test("TC-SCHED-020 | creates a PENDING job (not PUBLISHED)", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, FUTURE_DATE);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(jobData.status).toBe("PENDING");
  });

  // TC-SCHED-021
  test("TC-SCHED-021 | does NOT call axios (no immediate WP API call for scheduled jobs)", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, FUTURE_DATE);
    expect(axios.post).not.toHaveBeenCalled();
  });

  // TC-SCHED-022
  test("TC-SCHED-022 | scheduledAt stored in the job matches the requested time", async () => {
    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, FUTURE_DATE);

    const jobData = prisma.wordPressPublishJob.create.mock.calls[0][0].data;
    expect(new Date(jobData.scheduledAt).getTime()).toBe(FUTURE_DATE.getTime());
  });

  // TC-SCHED-023
  test("TC-SCHED-023 | result contains jobId", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, FUTURE_DATE);
    expect(result.jobId).toBeDefined();
  });

  // TC-SCHED-024
  test("TC-SCHED-024 | result contains scheduledAt timestamp", async () => {
    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, FUTURE_DATE);
    expect(result.scheduledAt).toBeDefined();
  });

  // TC-SCHED-025
  test("TC-SCHED-025 | reschedules existing PENDING job instead of creating duplicate", async () => {
    const NEW_FUTURE = new Date(FUTURE_DATE.getTime() + 1000 * 60 * 60);
    prisma.wordPressPublishJob.findFirst.mockResolvedValue(MOCK_PUBLISH_JOB_PENDING);
    prisma.wordPressPublishJob.update.mockResolvedValue({
      ...MOCK_PUBLISH_JOB_PENDING,
      scheduledAt: NEW_FUTURE,
    });

    const result = await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, NEW_FUTURE);

    expect(prisma.wordPressPublishJob.create).not.toHaveBeenCalled();
    expect(prisma.wordPressPublishJob.update).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  // TC-SCHED-026
  test("TC-SCHED-026 | rescheduled job status is reset to PENDING", async () => {
    prisma.wordPressPublishJob.findFirst.mockResolvedValue({
      ...MOCK_PUBLISH_JOB_PENDING,
      status: "IN_PROGRESS",
    });
    prisma.wordPressPublishJob.update.mockResolvedValue({});

    await scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, FUTURE_DATE);

    const updateData = prisma.wordPressPublishJob.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("PENDING");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 6E: Input Validation and Guard Clauses
// ═════════════════════════════════════════════════════════════════════════════

describe("scheduleWordPressPublish — validation", () => {

  // TC-SCHED-027
  test("TC-SCHED-027 | throws 404 when article does not exist", async () => {
    prisma.article.findUnique.mockResolvedValue(null);

    await expect(
      scheduleWordPressPublish("nonexistent_id", MOCK_USER.id, null)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // TC-SCHED-028
  test("TC-SCHED-028 | throws 403 when article belongs to a different user", async () => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE_OTHER_AUTHOR);

    await expect(
      scheduleWordPressPublish(MOCK_ARTICLE_OTHER_AUTHOR.id, MOCK_USER.id, null)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  // TC-SCHED-029
  test("TC-SCHED-029 | throws 400 when WordPress is not connected", async () => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE);
    prisma.wordPressConnection.findUnique.mockResolvedValue(null);

    await expect(
      scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  // TC-SCHED-030
  test("TC-SCHED-030 | error message mentions connecting WordPress when not connected", async () => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE);
    prisma.wordPressConnection.findUnique.mockResolvedValue(null);

    await expect(
      scheduleWordPressPublish(MOCK_ARTICLE.id, MOCK_USER.id, null)
    ).rejects.toMatchObject({ message: expect.stringMatching(/connect/i) });
  });

  // TC-SCHED-031
  test("TC-SCHED-031 | does not call WordPress API when article not found", async () => {
    prisma.article.findUnique.mockResolvedValue(null);

    await expect(
      scheduleWordPressPublish("bad_id", MOCK_USER.id, null)
    ).rejects.toThrow();

    expect(axios.post).not.toHaveBeenCalled();
  });

  // TC-SCHED-032
  test("TC-SCHED-032 | does not call WordPress API when user is not the author", async () => {
    prisma.article.findUnique.mockResolvedValue(MOCK_ARTICLE_OTHER_AUTHOR);

    await expect(
      scheduleWordPressPublish(MOCK_ARTICLE_OTHER_AUTHOR.id, MOCK_USER.id, null)
    ).rejects.toThrow();

    expect(axios.post).not.toHaveBeenCalled();
  });
});
