// tests/scraptests/scraper_job.test.js
// Tests for scraper.job.js:
//   1. cleanupStaleSessions — marks stuck "running" sessions as "canceled", emails admins
//   2. startScrapingJobs — runs startup cleanup before registering the cron
//
// acquireSessionLock has been removed from the codebase (the session lock
// mechanism was removed because it had a race window and is unnecessary
// in single-server production deployments). Its tests are removed accordingly.
//
// Mocks: prisma, node-cron, scraper.service, email.service

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

jest.mock("node-cron", () => ({
  schedule: jest.fn((expr, fn, opts) => {
    // Expose the scheduled callback so tests can invoke it directly
    mockCronCallback = fn;
  }),
}));

let mockCronCallback = null;

jest.mock("../../src/services/scraper.service", () => ({
  runScrapingSession: jest.fn().mockResolvedValue({ status: "completed", sessionId: "sess-cron" }),
}));

const mockSendCompletionNotification = jest.fn().mockResolvedValue(undefined);
jest.mock("../../src/services/email.service", () => ({
  sendCompletionNotification: mockSendCompletionNotification,
  sendErrorAlert:             jest.fn().mockResolvedValue(undefined),
}));

const prisma              = require("../../src/config/prisma");
const { runScrapingSession } = require("../../src/services/scraper.service");
const { cleanupStaleSessions, startScrapingJobs } = require("../../src/jobs/scraper.job");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStaleSession(overrides = {}) {
  return {
    id:                  "stale-sess-001",
    startedAt:           new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
    totalSources:        10,
    successCount:        5,
    duplicateCount:      2,
    failureCount:        1,
    enrichedCount:       3,
    keywordsCoveredCount: 10,
    aiInputTokens:       500,
    aiOutputTokens:      200,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// cleanupStaleSessions
// ════════════════════════════════════════════════════════════════════════════

describe("cleanupStaleSessions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
  });

  test("does nothing when no stale sessions exist", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);

    await cleanupStaleSessions();

    expect(prisma.scrapingSession.update).not.toHaveBeenCalled();
    expect(mockSendCompletionNotification).not.toHaveBeenCalled();
  });

  test("queries sessions with status 'running' and startedAt older than 3 hours", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);

    await cleanupStaleSessions();

    const callArg = prisma.scrapingSession.findMany.mock.calls[0][0];
    expect(callArg.where.status).toBe("running");
    expect(callArg.where.startedAt).toHaveProperty("lt");

    const ltTime      = callArg.where.startedAt.lt.getTime();
    const threeHourMs = 3 * 60 * 60 * 1000;
    expect(ltTime).toBeCloseTo(Date.now() - threeHourMs, -4);
  });

  test("marks each stale session as 'canceled'", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);

    await cleanupStaleSessions();

    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stale-sess-001" },
        data:  expect.objectContaining({ status: "canceled" }),
      })
    );
  });

  test("sets criticalErrors = true and completedAt on the canceled session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);

    await cleanupStaleSessions();

    const updateArg = prisma.scrapingSession.update.mock.calls[0][0];
    expect(updateArg.data.criticalErrors).toBe(true);
    expect(updateArg.data.completedAt).toBeInstanceOf(Date);
  });

  test("sends one interruption email per stale session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeStaleSession({ id: "stale-1" }),
      makeStaleSession({ id: "stale-2" }),
    ]);

    await cleanupStaleSessions();

    expect(mockSendCompletionNotification).toHaveBeenCalledTimes(2);
  });

  test("interruption email has isInterrupted: true and correct sessionId", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession({ id: "stale-sess-007" })]);

    await cleanupStaleSessions();

    const reportArg = mockSendCompletionNotification.mock.calls[0][0];
    expect(reportArg.isInterrupted).toBe(true);
    expect(reportArg.sessionId).toBe("stale-sess-007");
  });

  test("interruption email contains partial successCount from stale session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession({ successCount: 12 })]);

    await cleanupStaleSessions();

    const reportArg = mockSendCompletionNotification.mock.calls[0][0];
    expect(reportArg.successCount).toBe(12);
  });

  test("does not throw if email sending fails for a stale session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);
    mockSendCompletionNotification.mockRejectedValue(new Error("SMTP down"));

    await expect(cleanupStaleSessions()).resolves.not.toThrow();
  });

  test("does not throw if DB update fails for a stale session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);
    prisma.scrapingSession.update.mockRejectedValue(new Error("DB error"));

    await expect(cleanupStaleSessions()).resolves.not.toThrow();
  });

  test("handles multiple stale sessions — cancels all of them", async () => {
    const sessions = [
      makeStaleSession({ id: "stale-A" }),
      makeStaleSession({ id: "stale-B" }),
      makeStaleSession({ id: "stale-C" }),
    ];
    prisma.scrapingSession.findMany.mockResolvedValue(sessions);

    await cleanupStaleSessions();

    const updatedIds = prisma.scrapingSession.update.mock.calls.map((c) => c[0].where.id);
    expect(updatedIds).toContain("stale-A");
    expect(updatedIds).toContain("stale-B");
    expect(updatedIds).toContain("stale-C");
  });

  test("reportData written to DB contains canceledReason string", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);

    await cleanupStaleSessions();

    const updateArg    = prisma.scrapingSession.update.mock.calls[0][0];
    const reportData   = JSON.parse(updateArg.data.reportData);
    expect(typeof reportData.canceledReason).toBe("string");
    expect(reportData.canceledReason.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// startScrapingJobs — startup cleanup behaviour
// ════════════════════════════════════════════════════════════════════════════

describe("startScrapingJobs — startup stale session cleanup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCronCallback   = null;
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
  });

  test("runs cleanupStaleSessions at startup even when no stale sessions exist", async () => {
    // No stale sessions — cleanup should still be called without error
    prisma.scrapingSession.findMany.mockResolvedValue([]);

    await startScrapingJobs();

    // findMany must have been called (that is the startup cleanup query)
    expect(prisma.scrapingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "running" }) })
    );
  });

  test("cancels a stale session found during startup — no need to wait for next Saturday", async () => {
    // Session stuck in "running" from a previous force-kill
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession({ id: "stuck-at-start" })]);

    await startScrapingJobs();

    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stuck-at-start" },
        data:  expect.objectContaining({ status: "canceled" }),
      })
    );
  });

  test("sends interruption email at startup for a stuck session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession({ id: "startup-stale" })]);

    await startScrapingJobs();

    expect(mockSendCompletionNotification).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "startup-stale", isInterrupted: true })
    );
  });

  test("does not crash if startup cleanup throws — server still starts", async () => {
    prisma.scrapingSession.findMany.mockRejectedValue(new Error("DB unreachable at startup"));

    await expect(startScrapingJobs()).resolves.not.toThrow();
  });

  test("registers the cron job after cleanup completes", async () => {
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
// Cron tick behaviour — cleanup runs again before each session
// ════════════════════════════════════════════════════════════════════════════

describe("cron tick — cleanup runs before each session start", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockCronCallback = null;
    prisma.scrapingSession.findMany.mockResolvedValue([]); // no stale at startup
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
    runScrapingSession.mockResolvedValue({ status: "completed", sessionId: "cron-sess" });

    // Register the cron to capture its callback
    await startScrapingJobs();
  });

  test("cron callback runs cleanupStaleSessions before runScrapingSession", async () => {
    // A new stale session appears between startup and cron fire
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession({ id: "cron-stale" })]);

    expect(mockCronCallback).not.toBeNull();
    await mockCronCallback();

    // Cleanup should have run (update called for the new stale session)
    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cron-stale" } })
    );
    // Then the session should have started
    expect(runScrapingSession).toHaveBeenCalled();
  });

  test("cron session still runs when no stale sessions found", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);

    expect(mockCronCallback).not.toBeNull();
    await mockCronCallback();

    expect(runScrapingSession).toHaveBeenCalledTimes(1);
  });

  test("cron does not crash if runScrapingSession throws", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    runScrapingSession.mockRejectedValue(new Error("Session boom"));

    expect(mockCronCallback).not.toBeNull();
    await expect(mockCronCallback()).resolves.not.toThrow();
  });
});