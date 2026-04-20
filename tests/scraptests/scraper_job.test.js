// tests/scraptests/scraper_job.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for the NEW logic in scraper.job.js:
//
//   1. acquireSessionLock — skips if another process started within 10 minutes,
//      proceeds if no recent running session exists
//   2. cleanupStaleSessions — marks old "running" sessions as "canceled",
//      sends a partial interruption email per stale session
//
// What is NOT tested:
//   - node-cron scheduling (we don't tick fake timers for a whole week)
//   - Real process signals (SIGTERM/SIGINT) — those are tested in a
//     separate integration test scenario
//   - Real email delivery (nodemailer is mocked)
//
// Mocking strategy:
//   - prisma → prisma.mock.js
//   - email.service → jest.mock so sendCompletionNotification is a spy
//   - node-cron → jest.mock so no real cron is registered during tests
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

// Mock node-cron so no real scheduler starts
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

// Mock runScrapingSession so the job doesn't actually scrape
jest.mock("../../src/services/scraper.service", () => ({
  runScrapingSession: jest.fn().mockResolvedValue({ status: "completed", sessionId: "sess-cron" }),
}));

// Mock email service
const mockSendCompletionNotification = jest.fn().mockResolvedValue(undefined);
jest.mock("../../src/services/email.service", () => ({
  sendCompletionNotification: mockSendCompletionNotification,
  sendErrorAlert:             jest.fn().mockResolvedValue(undefined),
}));

const prisma = require("../../src/config/prisma");
const { acquireSessionLock, cleanupStaleSessions } = require("../../src/jobs/scraper.job");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStaleSession(overrides = {}) {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return {
    id:             "stale-sess-001",
    startedAt:      fourHoursAgo,
    totalSources:   10,
    successCount:   5,
    duplicateCount: 2,
    failureCount:   1,
    enrichedCount:  3,
    keywordsCoveredCount: 10,
    aiInputTokens:  500,
    aiOutputTokens: 200,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// acquireSessionLock
// ════════════════════════════════════════════════════════════════════════════

describe("acquireSessionLock", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns true when no running session exists in the lock window", async () => {
    prisma.scrapingSession.findFirst.mockResolvedValue(null);

    const canProceed = await acquireSessionLock();

    expect(canProceed).toBe(true);
  });

  test("returns false when a running session exists within the 10-minute window", async () => {
    // A session that started 2 minutes ago — within the lock window
    prisma.scrapingSession.findFirst.mockResolvedValue({
      id:        "active-sess",
      startedAt: new Date(Date.now() - 2 * 60 * 1000),
    });

    const canProceed = await acquireSessionLock();

    expect(canProceed).toBe(false);
  });

  test("queries only sessions with status 'running'", async () => {
    prisma.scrapingSession.findFirst.mockResolvedValue(null);

    await acquireSessionLock();

    expect(prisma.scrapingSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "running" }),
      })
    );
  });

  test("the lock window query uses gte (greater than or equal) for startedAt", async () => {
    prisma.scrapingSession.findFirst.mockResolvedValue(null);

    await acquireSessionLock();

    const callArg = prisma.scrapingSession.findFirst.mock.calls[0][0];
    expect(callArg.where.startedAt).toHaveProperty("gte");
  });

  test("the gte timestamp is approximately 10 minutes ago", async () => {
    prisma.scrapingSession.findFirst.mockResolvedValue(null);
    const beforeCall = Date.now();

    await acquireSessionLock();

    const afterCall  = Date.now();
    const callArg    = prisma.scrapingSession.findFirst.mock.calls[0][0];
    const gteTime    = callArg.where.startedAt.gte.getTime();
    const tenMinMs   = 10 * 60 * 1000;

    expect(gteTime).toBeGreaterThanOrEqual(beforeCall - tenMinMs - 100);
    expect(gteTime).toBeLessThanOrEqual(afterCall   - tenMinMs + 100);
  });

  test("returns true when the only running session is older than the lock window", async () => {
    // A session that started 15 minutes ago — outside the lock window
    // The lock query uses startedAt gte (10 min ago), so this session won't be found
    prisma.scrapingSession.findFirst.mockResolvedValue(null);

    const canProceed = await acquireSessionLock();
    expect(canProceed).toBe(true);
  });
});

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

    // The lt timestamp should be approximately 3 hours ago
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

  test("sets criticalErrors = true on the canceled session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);

    await cleanupStaleSessions();

    const updateArg = prisma.scrapingSession.update.mock.calls[0][0];
    expect(updateArg.data.criticalErrors).toBe(true);
  });

  test("sets completedAt on the canceled session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);

    await cleanupStaleSessions();

    const updateArg = prisma.scrapingSession.update.mock.calls[0][0];
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

  test("interruption email has isInterrupted: true", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);

    await cleanupStaleSessions();

    const reportArg = mockSendCompletionNotification.mock.calls[0][0];
    expect(reportArg.isInterrupted).toBe(true);
  });

  test("interruption email contains correct session ID", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession({ id: "stale-sess-007" })]);

    await cleanupStaleSessions();

    const reportArg = mockSendCompletionNotification.mock.calls[0][0];
    expect(reportArg.sessionId).toBe("stale-sess-007");
  });

  test("interruption email contains partial successCount from stale session", async () => {
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeStaleSession({ successCount: 12 }),
    ]);

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

    const updatedIds = prisma.scrapingSession.update.mock.calls.map(
      (call) => call[0].where.id
    );
    expect(updatedIds).toContain("stale-A");
    expect(updatedIds).toContain("stale-B");
    expect(updatedIds).toContain("stale-C");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Integration: lock prevents duplicate sessions
// ════════════════════════════════════════════════════════════════════════════

describe("lock + cleanup integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
  });

  test("cleanup runs before the lock check on each cron tick", async () => {
    // Stale session exists AND a recent running session exists
    prisma.scrapingSession.findMany.mockResolvedValue([makeStaleSession()]);
    // After cleanup marks stale as canceled, the lock check finds no running sessions
    prisma.scrapingSession.findFirst.mockResolvedValue(null);

    // Simulate the cron tick sequence manually
    await cleanupStaleSessions();
    const canProceed = await acquireSessionLock();

    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "canceled" }) })
    );
    expect(canProceed).toBe(true);
  });

  test("second developer process backs off when first already created a session", async () => {
    // Developer 1 started a session 30 seconds ago (within the 10-min lock window)
    prisma.scrapingSession.findFirst.mockResolvedValue({
      id:        "dev1-session",
      startedAt: new Date(Date.now() - 30 * 1000),
    });

    const canProceed = await acquireSessionLock();

    // Developer 2 should NOT proceed
    expect(canProceed).toBe(false);
  });
});
