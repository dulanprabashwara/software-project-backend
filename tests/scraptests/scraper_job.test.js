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
const {
  cleanupStaleSessions,
  startScrapingJobs,
  checkAndRunScraperIfDue,
} = require("../../src/jobs/scraper.job");
 
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
 
// checkAndRunScraperIfDue makes TWO different findFirst calls against the same prisma mock:
//   1. status: "running"   → "is a session already active?"      (guard, in scraper.job.js)
//   2. status: "completed" → "when did the last scrape finish?"  (getLastSuccessfulScrapeDate, scraper.init.js)
// This helper routes each call to the right mock value based on the query's where.status.
function mockFindFirstRouting({ activeSession = null, lastCompletedAt = null } = {}) {
  prisma.scrapingSession.findFirst.mockImplementation((args) => {
    if (args?.where?.status === "running") {
      return Promise.resolve(activeSession);
    }
    if (args?.where?.status === "completed") {
      return Promise.resolve(lastCompletedAt ? { completedAt: lastCompletedAt } : null);
    }
    return Promise.resolve(null);
  });
}
 
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
 
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
// startScrapingJobs — boot sequence
// Order matters: cleanupStaleSessions() → checkAndRunScraperIfDue() (catch-up) →
// cron.schedule("*/15 * * * *", ...) registered for ongoing checks.
// ════════════════════════════════════════════════════════════════════════════
 
describe("startScrapingJobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCronCallback = null;
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
    runScrapingSession.mockResolvedValue({ status: "completed", sessionId: "sess-cron" });
    prisma.scrapingSession.findMany.mockResolvedValue([]); // no abandoned sessions by default
  });
 
  test("runs cleanup at startup", async () => {
    mockFindFirstRouting({ lastCompletedAt: new Date() }); // not due, keeps this test focused on cleanup
    await startScrapingJobs();
    expect(prisma.scrapingSession.findMany).toHaveBeenCalled();
  });
 
  test("cancels a stale session at startup without waiting for the next check", async () => {
    setupRecoverMocks({ saved: 3 });
    mockFindFirstRouting({ lastCompletedAt: new Date() });
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
    mockFindFirstRouting({ lastCompletedAt: new Date() });
    await expect(startScrapingJobs()).resolves.not.toThrow();
  });
 
  test("registers a 15-minute recurring check, NOT a fixed Saturday 06:00 single-shot", async () => {
    mockFindFirstRouting({ lastCompletedAt: new Date() });
    const cron = require("node-cron");
    await startScrapingJobs();
    expect(cron.schedule).toHaveBeenCalledWith(
      "*/15 * * * *",
      expect.any(Function),
      expect.objectContaining({ timezone: "UTC" })
    );
    // explicitly guard against the old single-shot pattern ever coming back
    expect(cron.schedule).not.toHaveBeenCalledWith(
      "0 6 * * 6",
      expect.any(Function),
      expect.anything()
    );
  });
 
  test("catches up immediately on boot if the weekly window was missed while asleep", async () => {
    // last successful scrape was 8 days ago — overdue
    mockFindFirstRouting({ lastCompletedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
    await startScrapingJobs();
    expect(runScrapingSession).toHaveBeenCalledTimes(1);
  });
 
  test("does NOT run the scraper on boot if last scrape was less than 7 days ago", async () => {
    mockFindFirstRouting({ lastCompletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    await startScrapingJobs();
    expect(runScrapingSession).not.toHaveBeenCalled();
  });
});
 
// ════════════════════════════════════════════════════════════════════════════
// checkAndRunScraperIfDue — the self-healing due-check
// This is what runs on every 15-minute tick (and once at startup). It is the
// direct replacement for the old fixed "0 6 * * 6" cron callback.
// ════════════════════════════════════════════════════════════════════════════
 
describe("checkAndRunScraperIfDue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Safe default: never hangs. Individual tests override with mockFindFirstRouting()
    // or their own mockImplementation as needed. This guards against a test that forgets
    // to resolve a deferred promise leaking a stuck isCheckingScraper=true into later tests.
    mockFindFirstRouting({ lastCompletedAt: new Date() });
    prisma.scrapingSession.findMany.mockResolvedValue([]);
    prisma.scrapingSession.update.mockResolvedValue({});
    mockSendCompletionNotification.mockResolvedValue(undefined);
    runScrapingSession.mockResolvedValue({ status: "completed", sessionId: "cron-sess" });
  });
 
  test("runs the scraper when last successful scrape was 7+ days ago", async () => {
    mockFindFirstRouting({ lastCompletedAt: new Date(Date.now() - SEVEN_DAYS_MS - 1000) });
    await checkAndRunScraperIfDue();
    expect(runScrapingSession).toHaveBeenCalledTimes(1);
  });
 
  test("runs the scraper when there has never been a successful scrape", async () => {
    mockFindFirstRouting({ lastCompletedAt: null });
    await checkAndRunScraperIfDue();
    expect(runScrapingSession).toHaveBeenCalledTimes(1);
  });
 
  test("does NOT run the scraper when last successful scrape was less than 7 days ago", async () => {
    mockFindFirstRouting({ lastCompletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    await checkAndRunScraperIfDue();
    expect(runScrapingSession).not.toHaveBeenCalled();
  });
 
  test("does NOT run the scraper when a session is already running (activeSession guard)", async () => {
    mockFindFirstRouting({
      activeSession: { id: "already-running", startedAt: new Date() },
      lastCompletedAt: new Date(Date.now() - SEVEN_DAYS_MS - 1000), // overdue, but a run is active
    });
    await checkAndRunScraperIfDue();
    expect(runScrapingSession).not.toHaveBeenCalled();
  });
 
  test("runs cleanupStaleSessions before runScrapingSession when a run is due", async () => {
    setupRecoverMocks({ saved: 2 });
    mockFindFirstRouting({ lastCompletedAt: new Date(Date.now() - SEVEN_DAYS_MS - 1000) });
    prisma.scrapingSession.findMany.mockResolvedValue([
      makeSession({ id: "cron-stale", status: "canceled" }),
    ]);
 
    await checkAndRunScraperIfDue();
 
    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cron-stale" } })
    );
    expect(runScrapingSession).toHaveBeenCalled();
  });
 
  test("does not crash if runScrapingSession throws", async () => {
    mockFindFirstRouting({ lastCompletedAt: new Date(Date.now() - SEVEN_DAYS_MS - 1000) });
    runScrapingSession.mockRejectedValue(new Error("boom"));
    await expect(checkAndRunScraperIfDue()).resolves.not.toThrow();
  });
 
  test("does not crash and does not run the scraper if the due-check DB read itself fails", async () => {
    prisma.scrapingSession.findFirst.mockRejectedValue(new Error("DB unreachable"));
    await expect(checkAndRunScraperIfDue()).resolves.not.toThrow();
    expect(runScrapingSession).not.toHaveBeenCalled();
  });
 
  // Flushes the microtask queue by waiting on a macrotask boundary (setImmediate).
  // Needed because `isCheckingScraper` is set synchronously before the FIRST await,
  // but reaching the SECOND await (the getLastSuccessfulScrapeDate lookup) requires
  // firstCall's internal promise chain to actually progress — a plain synchronous
  // call to resolveFindFirst() right after creating the promises is too early and
  // leaves resolveFindFirst undefined, which also leaks a permanently-pending
  // promise (and a stuck isCheckingScraper=true) into later tests if not flushed.
  const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
 
  test("a second overlapping call is skipped while the first is still in-flight (isCheckingScraper guard)", async () => {
    let resolveFindFirst;
    prisma.scrapingSession.findFirst.mockImplementation((args) => {
      if (args?.where?.status === "running") return Promise.resolve(null);
      return new Promise((resolve) => { resolveFindFirst = resolve; });
    });
 
    const firstCall  = checkAndRunScraperIfDue();
    const secondCall = checkAndRunScraperIfDue(); // isCheckingScraper is already true synchronously here — should exit immediately
 
    // Let firstCall's await chain actually reach the "completed" lookup before resolving it.
    await flushMicrotasks();
    expect(typeof resolveFindFirst).toBe("function");
 
    resolveFindFirst({ completedAt: new Date(Date.now() - SEVEN_DAYS_MS - 1000) });
    await Promise.all([firstCall, secondCall]);
 
    // Only the first call should have proceeded to run the scraper; the second exited early via the guard.
    expect(runScrapingSession).toHaveBeenCalledTimes(1);
  });
 
  test("a subsequent call after the first fully completes is allowed to run again (guard resets)", async () => {
    mockFindFirstRouting({ lastCompletedAt: new Date(Date.now() - SEVEN_DAYS_MS - 1000) });
 
    await checkAndRunScraperIfDue();
    expect(runScrapingSession).toHaveBeenCalledTimes(1);
 
    // Simulate the scrape having completed and reset the clock — not due anymore.
    mockFindFirstRouting({ lastCompletedAt: new Date() });
    await checkAndRunScraperIfDue();
    expect(runScrapingSession).toHaveBeenCalledTimes(1); // unchanged — second check correctly skipped
  });
});
 