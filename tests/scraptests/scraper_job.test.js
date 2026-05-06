// tests/scraptests/scraper_job.test.js
// Tests for scraper.job.js — cleanup, startup, and cron behaviour.
//
// Key behaviours tested:
//   - cleanupStaleSessions finds BOTH "canceled" (email pending) and "running" (force-killed)
//   - completed/failed sessions are NEVER touched regardless of reportSentAt (core bug fix)
//   - reportSentAt is set only after email succeeds, enabling retry on next startup
//   - durationMinutes uses completedAt when set, not Date.now() (avoids inflated duration)
//   - completedAt from signal handler is preserved, not overwritten
//   - recoverSessionStats reads ScrapedArticle for ground-truth counts
//   - startScrapingJobs runs cleanup at startup before registering cron

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

jest.mock("node-cron", () => ({
  schedule: jest.fn((expr, fn, opts) => { mockCronCallback = fn; }),
}));

let mockCronCallback = null;

jest.mock("../../src/services/scraper.service", () => ({
  runScrapingSession: jest.fn().mockResolvedValue({ status: "completed", sessionId: "sess-cron" }),
}));

const mockSendCompletionNotification = jest.fn().mockResolvedValue(undefined);
const mockSendErrorAlert             = jest.fn().mockResolvedValue(undefined);
jest.mock("../../src/services/email.service", () => ({
  sendCompletionNotification: mockSendCompletionNotification,
  sendErrorAlert:             mockSendErrorAlert,
}));

const prisma                 = require("../../src/config/prisma");
const { runScrapingSession } = require("../../src/services/scraper.service");
const { cleanupStaleSessions, startScrapingJobs } = require("../../src/jobs/scraper.job");

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    id:                   "sess-001",
    status:               "running",
    startedAt:            new Date(Date.now() - 4 * 60 * 60 * 1000),
    completedAt:          null,
    totalSources:         10,
    successCount:         5,
    duplicateCount:       2,
    failureCount:         1,
    enrichedCount:        3,
    keywordsCoveredCount: 10,
    aiInputTokens:        500,
    aiOutputTokens:       200,
    ...overrides,
  };
}

function setupRecoverMocks({ saved = 0, enriched = 0, aiIn = 0, aiOut = 0, failedCount = 0 } = {}) {
  prisma.scrapedArticle.count
    .mockResolvedValueOnce(saved)
    .mockResolvedValueOnce(enriched);
  prisma.scrapingSession.findUnique.mockResolvedValue({
    aiInputTokens:         aiIn,
    aiOutputTokens:        aiOut,
    enrichmentFailedCount: failedCount,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Query structure
// ════════════════════════════════════════════════════════════════════════════

describe("cleanupStaleSessions — query structure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scrapingSession.update.mockResolvedValue({});
  });

  test("does nothing when no abandoned sessions exist", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    expect(prisma.scrapingSession.update).not.toHaveBeenCalled();
    expect(mockSendCompletionNotification).not.toHaveBeenCalled();
  });

  test("filters reportSentAt: null — already-emailed sessions are never re-processed", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const callArg = prisma.scrapingSession.findMany.mock.calls[0][0];
    expect(callArg.where.reportSentAt).toBeNull();
  });

  test("excludes completed and failed sessions from the query", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const callArg = prisma.scrapingSession.findMany.mock.calls[0][0];
    expect(callArg.where.status.notIn).toContain("completed");
    expect(callArg.where.status.notIn).toContain("failed");
  });

  test("query OR covers both the canceled-unreported path and the force-killed path", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const { OR } = prisma.scrapingSession.findMany.mock.calls[0][0].where;
    expect(Array.isArray(OR)).toBe(true);
    expect(OR.some((b) => b.status === "canceled")).toBe(true);
    expect(OR.some((b) => b.status === "running")).toBe(true);
  });

  test("running branch requires startedAt older than 3 hours", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const { OR } = prisma.scrapingSession.findMany.mock.calls[0][0].where;
    const runningBranch = OR.find((b) => b.status === "running");
    const cutoff        = runningBranch.startedAt.lt.getTime();
    expect(cutoff).toBeCloseTo(Date.now() - 3 * 60 * 60 * 1000, -4);
  });

  test("canceled branch has no age restriction — recently-killed sessions get email fast", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const { OR }         = prisma.scrapingSession.findMany.mock.calls[0][0].where;
    const canceledBranch = OR.find((b) => b.status === "canceled");
    expect(canceledBranch).toEqual({ status: "canceled" });
    expect(canceledBranch.startedAt).toBeUndefined();
  });

  test("select includes completedAt for accurate duration calculation", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const callArg = prisma.scrapingSession.findMany.mock.calls[0][0];
    expect(callArg.select.completedAt).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Completed/failed session protection — THE CORE BUG FIX
// Real scenario: both developers ran sessions at 06:00, both completed by 06:13,
// then killed their backends at 06:54 / 07:15. The signal handler fired and
// attempted to overwrite status="completed" with status="canceled".
// ════════════════════════════════════════════════════════════════════════════

describe("cleanupStaleSessions — completed/failed sessions never reverted", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scrapingSession.update.mockResolvedValue({});
  });

  test("query has notIn guard — completed sessions cannot be returned", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const callArg = prisma.scrapingSession.findMany.mock.calls[0][0];
    expect(callArg.where.status.notIn).toContain("completed");
    expect(prisma.scrapingSession.update).not.toHaveBeenCalled();
  });

  test("query has notIn guard — failed sessions cannot be returned", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const callArg = prisma.scrapingSession.findMany.mock.calls[0][0];
    expect(callArg.where.status.notIn).toContain("failed");
    expect(prisma.scrapingSession.update).not.toHaveBeenCalled();
  });

  test("a canceled session with reportSentAt already set is excluded by the outer filter", async () => {
    // reportSentAt: null is the outer WHERE — sessions with reportSentAt set never appear
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await cleanupStaleSessions();
    const callArg = prisma.scrapingSession.findMany.mock.calls[0][0];
    expect(callArg.where.reportSentAt).toBeNull();
  });

  test("two concurrent sessions — only the canceled one is processed, completed one is ignored", async () => {
    // Session A completed at 06:13, reportSentAt set — NOT in query result (reportSentAt not null)
    // Session B was canceled — IS in query result
    setupRecoverMocks({ saved: 11 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ id: "sess-B", status: "canceled", successCount: 11 }),
      // sess-A would not appear in the query due to reportSentAt filter
    ]);

    await cleanupStaleSessions();

    const updatedIds = prisma.scrapingSession.update.mock.calls
      .map((c) => c[0].where?.id)
      .filter(Boolean);
    expect(updatedIds).not.toContain("sess-A");
    expect(updatedIds).toContain("sess-B");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// durationMinutes accuracy
// ════════════════════════════════════════════════════════════════════════════

describe("cleanupStaleSessions — durationMinutes accuracy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
  });

  test("uses completedAt - startedAt when completedAt is set (real session duration)", async () => {
    const startedAt   = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const completedAt = new Date(Date.now() - 50 * 60 * 1000); // stopped 50min ago → 10min session
    setupRecoverMocks({ saved: 5 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ status: "canceled", startedAt, completedAt }),
    ]);

    await cleanupStaleSessions();

    const updateArg = prisma.scrapingSession.update.mock.calls[0][0];
    expect(updateArg.data.durationMinutes).toBeGreaterThan(9);
    expect(updateArg.data.durationMinutes).toBeLessThan(11);
  });

  test("uses Date.now() - startedAt when completedAt is null (force-killed, no handler ran)", async () => {
    const startedAt = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4h ago
    setupRecoverMocks({ saved: 5 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ status: "running", startedAt, completedAt: null }),
    ]);

    await cleanupStaleSessions();

    const updateArg = prisma.scrapingSession.update.mock.calls[0][0];
    expect(updateArg.data.durationMinutes).toBeGreaterThan(230);
    expect(updateArg.data.durationMinutes).toBeLessThan(250);
  });

  test("preserves existing completedAt from signal handler — does not overwrite with Date.now()", async () => {
    const existingCompletedAt = new Date(Date.now() - 50 * 60 * 1000);
    setupRecoverMocks({ saved: 5 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ status: "canceled", completedAt: existingCompletedAt }),
    ]);

    await cleanupStaleSessions();

    const firstUpdate = prisma.scrapingSession.update.mock.calls[0][0];
    // completedAt should not appear in the stats update when it's already set
    expect(firstUpdate.data.completedAt).toBeUndefined();
  });

  test("sets completedAt when it is null — force-killed session had no signal handler", async () => {
    setupRecoverMocks({ saved: 5 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ status: "running", completedAt: null }),
    ]);

    await cleanupStaleSessions();

    const updateArg = prisma.scrapingSession.update.mock.calls[0][0];
    expect(updateArg.data.completedAt).toBeInstanceOf(Date);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// reportSentAt retry behaviour
// ════════════════════════════════════════════════════════════════════════════

describe("cleanupStaleSessions — reportSentAt set only after email succeeds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scrapingSession.update.mockResolvedValue({});
  });

  test("sets reportSentAt after successful email send", async () => {
    mockSendCompletionNotification.mockResolvedValue(undefined);
    setupRecoverMocks({ saved: 5 });
    prisma.scrapingSession.findMany.mockResolvedValue([makeSession({ status: "canceled" })]);

    await cleanupStaleSessions();

    const allUpdates = prisma.scrapingSession.update.mock.calls;
    const reportSentCall = allUpdates.find((c) => c[0].data.reportSentAt instanceof Date);
    expect(reportSentCall).toBeDefined();
  });

  test("does NOT set reportSentAt when email throws — session retried on next startup", async () => {
    mockSendCompletionNotification.mockRejectedValue(new Error("SMTP timeout"));
    setupRecoverMocks({ saved: 5 });
    prisma.scrapingSession.findMany.mockResolvedValue([makeSession({ status: "canceled" })]);

    await expect(cleanupStaleSessions()).resolves.not.toThrow();

    const allUpdates     = prisma.scrapingSession.update.mock.calls;
    const reportSentCall = allUpdates.find((c) => c[0].data.reportSentAt instanceof Date);
    expect(reportSentCall).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// recoverSessionStats — ground truth from ScrapedArticle
// ════════════════════════════════════════════════════════════════════════════

describe("recoverSessionStats — reads counts from ScrapedArticle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
  });

  test("queries ScrapedArticle.count by sessionId for saved articles", async () => {
    setupRecoverMocks({ saved: 10, enriched: 7 });
    prisma.scrapingSession.findMany.mockResolvedValue([makeSession({ status: "canceled" })]);

    await cleanupStaleSessions();

    expect(prisma.scrapedArticle.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sessionId: "sess-001" }) })
    );
  });

  test("queries ScrapedArticle.count with summary: not null for enriched count", async () => {
    setupRecoverMocks({ saved: 10, enriched: 7 });
    prisma.scrapingSession.findMany.mockResolvedValue([makeSession({ status: "canceled" })]);

    await cleanupStaleSessions();

    expect(prisma.scrapedArticle.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ summary: { not: null } }) })
    );
  });

  test("recovered enrichedArticles flows into email report enrichedCount", async () => {
    setupRecoverMocks({ saved: 12, enriched: 10 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ status: "canceled", successCount: 0, duplicateCount: 0, failureCount: 0 }),
    ]);

    await cleanupStaleSessions();

    const report = mockSendCompletionNotification.mock.calls[0][0];
    expect(report.enrichedCount).toBe(10);
  });

  test("reads aiInputTokens and aiOutputTokens from session row for token reporting", async () => {
    setupRecoverMocks({ saved: 5, enriched: 3, aiIn: 44678, aiOut: 7639 });
    prisma.scrapingSession.findMany.mockResolvedValue([makeSession({ status: "canceled" })]);

    await cleanupStaleSessions();

    const report = mockSendCompletionNotification.mock.calls[0][0];
    expect(report.aiTokenUsage.inputTokens).toBe(44678);
    expect(report.aiTokenUsage.outputTokens).toBe(7639);
  });

  test("gracefully falls back to session row stats if ScrapedArticle count throws", async () => {
    prisma.scrapedArticle.count.mockRejectedValue(new Error("count failed"));
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ status: "canceled", successCount: 5 }),
    ]);

    await expect(cleanupStaleSessions()).resolves.not.toThrow();
    expect(mockSendCompletionNotification).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// startScrapingJobs
// ════════════════════════════════════════════════════════════════════════════

describe("startScrapingJobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCronCallback = null;
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
    runScrapingSession.mockResolvedValue({ status: "completed", sessionId: "sess-cron" });
  });

  test("runs cleanup at startup", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await startScrapingJobs();
    expect(prisma.scrapingSession.findMany).toHaveBeenCalled();
  });

  test("cancels a stale session at startup without waiting for Saturday", async () => {
    setupRecoverMocks({ saved: 3 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ id: "startup-stuck", status: "canceled" }),
    ]);
    await startScrapingJobs();
    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "startup-stuck" } })
    );
  });

  test("server still starts if startup cleanup throws", async () => {
    prisma.scrapingSession.findMany.mockRejectedValue(new Error("DB unreachable"));
    await expect(startScrapingJobs()).resolves.not.toThrow();
  });

  test("registers cron on Saturday 06:00 UTC", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    const cron = require("node-cron");
    await startScrapingJobs();
    expect(cron.schedule).toHaveBeenCalledWith(
      "0 6 * * 6",
      expect.any(Function),
      expect.objectContaining({ timezone: "UTC" })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Cron tick
// ════════════════════════════════════════════════════════════════════════════

describe("cron tick", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockCronCallback = null;
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
    runScrapingSession.mockResolvedValue({ status: "completed", sessionId: "cron-sess" });
    await startScrapingJobs();
  });

  test("cleanup runs before runScrapingSession on each tick", async () => {
    setupRecoverMocks({ saved: 2 });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ id: "cron-stale", status: "canceled" }),
    ]);
    await mockCronCallback();
    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cron-stale" } })
    );
    expect(runScrapingSession).toHaveBeenCalled();
  });

  test("session runs when no stale sessions found", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    await mockCronCallback();
    expect(runScrapingSession).toHaveBeenCalledTimes(1);
  });

  test("cron does not crash if runScrapingSession throws", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    runScrapingSession.mockRejectedValue(new Error("boom"));
    await expect(mockCronCallback()).resolves.not.toThrow();
  });
});