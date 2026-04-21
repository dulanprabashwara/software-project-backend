// tests/scraptests/enrichment_runtime.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for the runtime logic in enrichment.service.js
//
//   1. RateLimitManager class — state, timing, exponential backoff
//   2. callOpenRouter — fallback behaviour
//   3. runManualEnrichment — per-session stats update, multi-session support,
//      email notification, sendEmail opt-out, return shape
//
// KEY BEHAVIOURAL CHANGES in this version:
//   - runManualEnrichment updates EACH ARTICLE'S OWN SESSION directly.
//     No separate ManualEnrichmentSession model.
//   - findMany select now includes sessionId (required for grouping by session).
//   - sendEmail option (default: true) and SEND_MANUAL_ENRICHMENT_EMAIL env var
//     both control whether the completion email fires.
//   - Return value now includes sessionsUpdated: string[].
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

const mockCreate = jest.fn();
jest.mock("openai", () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const mockSendMail = jest.fn().mockResolvedValue({ messageId: "test-id" });
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const mockSendCompletionNotification = jest.fn().mockResolvedValue(undefined);
jest.mock("../../src/services/email.service", () => ({
  sendCompletionNotification: mockSendCompletionNotification,
  sendErrorAlert:             jest.fn().mockResolvedValue(undefined),
}));

const prisma = require("../../src/config/prisma");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAiResponse(articles) {
  return JSON.stringify(articles.map((a) => ({
    id:              a.id,
    matchedKeywords: ["Artificial intelligence"],
    summary:         "A detailed factual summary spanning approximately one hundred and forty words.",
  })));
}

function makeUsage(input = 100, output = 50) {
  return { prompt_tokens: input, completion_tokens: output };
}

function makeArticle(overrides = {}) {
  return {
    id:        "art-001",
    title:     "Test Article About AI",
    content:   "Long content about artificial intelligence and machine learning.",
    sourceUrl: "https://example.com/article-1",
    category:  "Technology & Digital Life",
    sessionId: "sess-123",
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return {
    id:                    "sess-123",
    startedAt:             new Date("2025-04-05T06:00:00Z"),
    totalSources:          8,
    successCount:          20,
    duplicateCount:        2,
    failureCount:          0,
    successRate:           100,
    durationMinutes:       30,
    enrichedCount:         0,
    enrichmentFailedCount: 0,
    keywordsCoveredCount:  0,
    keywordsEmptyCount:    0,
    aiInputTokens:         0,
    aiOutputTokens:        0,
    criticalErrors:        false,
    ...overrides,
  };
}

function defaultMocks(sessionId = "sess-123") {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: "[]" } }],
    usage:   makeUsage(),
  });
  prisma.scrapedArticle.findMany.mockResolvedValue([]);
  prisma.scrapedArticle.count.mockResolvedValue(0);
  prisma.scrapingSession.findFirst.mockResolvedValue({ id: sessionId });
  prisma.scrapingSession.findUnique.mockResolvedValue(makeSession({ id: sessionId }));
  prisma.scrapingSession.update.mockResolvedValue({});
  prisma.scrapingLog.create.mockResolvedValue({});
  prisma.user.findMany.mockResolvedValue([{ email: "admin@test.com" }]);
  mockSendCompletionNotification.mockResolvedValue(undefined);
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: RateLimitManager
// ══════════════════════════════════════════════════════════════════════════════

class RateLimitManager {
  constructor() {
    this.isAccountLimited = false;
    this.lastLimitTime    = null;
    this.limitResetTime   = null;
    this.failedBatchCount = 0;
  }
  markLimited() {
    this.isAccountLimited = true;
    this.lastLimitTime    = Date.now();
    this.limitResetTime   = Date.now() + 60000;
  }
  isLimitExpired() {
    if (!this.isAccountLimited) return false;
    if (Date.now() >= this.limitResetTime) { this.isAccountLimited = false; return true; }
    return false;
  }
  getWaitTime() {
    const delays = [2000, 4000, 8000, 16000, 30000, 60000];
    return delays[Math.min(this.failedBatchCount, delays.length - 1)];
  }
}

describe("RateLimitManager", () => {
  test("starts in a clean (not limited) state", () => {
    const mgr = new RateLimitManager();
    expect(mgr.isAccountLimited).toBe(false);
    expect(mgr.failedBatchCount).toBe(0);
  });
  test("markLimited() sets isAccountLimited to true", () => {
    const mgr = new RateLimitManager(); mgr.markLimited();
    expect(mgr.isAccountLimited).toBe(true);
  });
  test("markLimited() records a limitResetTime 60 seconds in the future", () => {
    const before = Date.now(); const mgr = new RateLimitManager(); mgr.markLimited(); const after = Date.now();
    expect(mgr.limitResetTime).toBeGreaterThanOrEqual(before + 59000);
    expect(mgr.limitResetTime).toBeLessThanOrEqual(after   + 61000);
  });
  test("isLimitExpired() returns false when not limited at all", () => {
    expect(new RateLimitManager().isLimitExpired()).toBe(false);
  });
  test("isLimitExpired() returns false when limit is still active", () => {
    const mgr = new RateLimitManager(); mgr.markLimited();
    expect(mgr.isLimitExpired()).toBe(false);
  });
  test("isLimitExpired() returns true and clears flag when reset time has passed", () => {
    const mgr = new RateLimitManager(); mgr.markLimited();
    mgr.limitResetTime = Date.now() - 1000;
    expect(mgr.isLimitExpired()).toBe(true);
    expect(mgr.isAccountLimited).toBe(false);
  });
  test("getWaitTime() returns 2000ms for the first failure", () => {
    const mgr = new RateLimitManager(); mgr.failedBatchCount = 0;
    expect(mgr.getWaitTime()).toBe(2000);
  });
  test("getWaitTime() doubles on each failure (exponential backoff)", () => {
    const mgr = new RateLimitManager();
    [2000, 4000, 8000, 16000, 30000, 60000].forEach((ms, i) => {
      mgr.failedBatchCount = i; expect(mgr.getWaitTime()).toBe(ms);
    });
  });
  test("getWaitTime() caps at 60000ms regardless of failure count", () => {
    const mgr = new RateLimitManager(); mgr.failedBatchCount = 999;
    expect(mgr.getWaitTime()).toBe(60000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: callOpenRouter
// ══════════════════════════════════════════════════════════════════════════════

describe("callOpenRouter — rate limit and fallback behaviour", () => {
  beforeEach(() => { jest.clearAllMocks(); defaultMocks("sess-123"); });

  test("succeeds immediately when first model returns valid content", async () => {
    const article = makeArticle();
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage(200, 80) });
    prisma.scrapedArticle.update.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-123", category: "Technology & Digital Life" });
    expect(result.enrichedCount).toBe(1);
    expect(result.enrichmentFailed).toBe(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test("falls back to individual processing when batch parse fails", async () => {
    const article = makeArticle();
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: "THIS IS NOT JSON AT ALL" } }], usage: makeUsage() })
      .mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage(100, 40) });
    prisma.scrapedArticle.update.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-123", category: "Technology & Digital Life" });
    expect(result.enrichedCount).toBe(1);
  });

  test("records token usage from successful AI calls", async () => {
    const article = makeArticle();
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage(300, 120) });
    prisma.scrapedArticle.update.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-123", category: "Technology & Digital Life" });
    expect(result.tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.outputTokens).toBeGreaterThan(0);
  });

  test("counts a failed DB update as enrichmentFailed (not enrichedCount)", async () => {
    const article = makeArticle();
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage() });
    prisma.scrapedArticle.update.mockRejectedValue(new Error("DB constraint violation"));
    prisma.scrapingLog.create.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-123", category: "Technology & Digital Life" });
    expect(result.enrichedCount).toBe(0);
    expect(result.enrichmentFailed).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: runManualEnrichment — session stats update
// ══════════════════════════════════════════════════════════════════════════════

describe("runManualEnrichment — session stats update", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defaultMocks("sess-456");
    delete process.env.SEND_MANUAL_ENRICHMENT_EMAIL;
  });

  test("calls scrapingSession.update on the article's own sessionId", async () => {
    const article = makeArticle({ sessionId: "sess-456" });
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage(200, 80) });
    prisma.scrapedArticle.update.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-456", category: "Technology & Digital Life" });
    expect(prisma.scrapingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sess-456" }, data: expect.objectContaining({ enrichedCount: expect.any(Number) }) })
    );
  });

  test("merges new enrichedCount on top of existing session enrichedCount", async () => {
    const article = makeArticle({ sessionId: "sess-456" });
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    prisma.scrapingSession.findUnique.mockResolvedValue(makeSession({ id: "sess-456", enrichedCount: 5 }));
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage() });
    prisma.scrapedArticle.update.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-456", category: "Technology & Digital Life" });
    const updateCall = prisma.scrapingSession.update.mock.calls[0][0];
    expect(updateCall.data.enrichedCount).toBe(6);
  });

  test("updates aiInputTokens and aiOutputTokens in the session record", async () => {
    const article = makeArticle({ sessionId: "sess-456" });
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    prisma.scrapingSession.findUnique.mockResolvedValue(makeSession({ id: "sess-456", aiInputTokens: 1000, aiOutputTokens: 500 }));
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage(300, 120) });
    prisma.scrapedArticle.update.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-456", category: "Technology & Digital Life" });
    const updateCall = prisma.scrapingSession.update.mock.calls[0][0];
    expect(updateCall.data.aiInputTokens).toBe(1300);
    expect(updateCall.data.aiOutputTokens).toBe(620);
  });

  test("verifies at least one session exists when no sessionId filter provided", async () => {
    prisma.scrapingSession.findFirst.mockResolvedValue({ id: "latest-sess" });
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ category: "Technology & Digital Life" });
    expect(prisma.scrapingSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: "desc" } })
    );
  });

  test("throws when no sessions exist and no sessionId provided", async () => {
    prisma.scrapingSession.findFirst.mockResolvedValue(null);
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await expect(runManualEnrichment({})).rejects.toThrow(/No scraping sessions exist/);
  });

  test("skips unknown category with a warning rather than crashing", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await expect(runManualEnrichment({ sessionId: "sess-456", category: "Aliens & UFOs" })).resolves.not.toThrow();
  });

  test("only queries articles for the filtered category when category is provided", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-456", category: "Health & Medicine" });
    const calls = prisma.scrapedArticle.findMany.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].where.category).toBe("Health & Medicine");
  });

  test("returns totalFound = 0 when all articles are already enriched", async () => {
    prisma.scrapedArticle.findMany.mockResolvedValue([]);
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-456" });
    expect(result.totalFound).toBe(0);
    expect(result.enrichedCount).toBe(0);
  });

  test("filters by sessionId in the findMany where clause when sessionId given", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-456", category: "Technology & Digital Life" });
    const whereClause = prisma.scrapedArticle.findMany.mock.calls[0][0].where;
    expect(whereClause.sessionId).toBe("sess-456");
    expect(whereClause.summary).toBeNull();
  });

  test("does NOT include sessionId in where clause when enriching all sessions", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ category: "Technology & Digital Life" });
    const whereClause = prisma.scrapedArticle.findMany.mock.calls[0][0].where;
    expect(whereClause.sessionId).toBeUndefined();
  });

  test("findMany select includes sessionId so articles know their own session", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-456", category: "Technology & Digital Life" });
    const selectClause = prisma.scrapedArticle.findMany.mock.calls[0][0].select;
    expect(selectClause).toHaveProperty("sessionId");
  });

  test("return value includes sessionsUpdated array with updated session IDs", async () => {
    const article = makeArticle({ sessionId: "sess-456" });
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage() });
    prisma.scrapedArticle.update.mockResolvedValue({});
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-456", category: "Technology & Digital Life" });
    expect(Array.isArray(result.sessionsUpdated)).toBe(true);
    expect(result.sessionsUpdated).toContain("sess-456");
  });

  test("does not call scrapingSession.update when no articles were enriched", async () => {
    prisma.scrapedArticle.findMany.mockResolvedValue([]);
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-456" });
    expect(prisma.scrapingSession.update).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: runManualEnrichment — email notification
// ══════════════════════════════════════════════════════════════════════════════

describe("runManualEnrichment — email notification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defaultMocks("sess-789");
    delete process.env.SEND_MANUAL_ENRICHMENT_EMAIL;
  });

  test("calls sendCompletionNotification after enrichment completes", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-789" });
    expect(mockSendCompletionNotification).toHaveBeenCalledTimes(1);
  });

  test("passes isManualEnrichment: true in the email report", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-789" });
    expect(mockSendCompletionNotification.mock.calls[0][0].isManualEnrichment).toBe(true);
  });

  test("email report contains the correct sessionId", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-789" });
    expect(mockSendCompletionNotification.mock.calls[0][0].sessionId).toBe("sess-789");
  });

  test("email report contains enrichedCount matching what was processed", async () => {
    const article = makeArticle({ sessionId: "sess-789" });
    prisma.scrapedArticle.findMany.mockResolvedValueOnce([article]).mockResolvedValue([]);
    mockCreate.mockResolvedValue({ choices: [{ message: { content: makeAiResponse([article]) } }], usage: makeUsage() });
    prisma.scrapedArticle.update.mockResolvedValue({});
    prisma.scrapingSession.findUnique.mockResolvedValue(makeSession({ id: "sess-789" }));
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-789", category: "Technology & Digital Life" });
    expect(mockSendCompletionNotification.mock.calls[0][0].enrichedCount).toBe(1);
  });

  test("does NOT crash enrichment if email sending fails", async () => {
    mockSendCompletionNotification.mockRejectedValue(new Error("SMTP timeout"));
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await expect(runManualEnrichment({ sessionId: "sess-789" })).resolves.not.toThrow();
  });

  test("does not send email when sendEmail: false is passed", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-789", sendEmail: false });
    expect(mockSendCompletionNotification).not.toHaveBeenCalled();
  });

  test("does not send email when SEND_MANUAL_ENRICHMENT_EMAIL=false env var is set", async () => {
    process.env.SEND_MANUAL_ENRICHMENT_EMAIL = "false";
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-789" });
    expect(mockSendCompletionNotification).not.toHaveBeenCalled();
    delete process.env.SEND_MANUAL_ENRICHMENT_EMAIL;
  });

  test("does not send email when no session data can be found for the report", async () => {
    prisma.scrapingSession.findUnique.mockResolvedValue(null);
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    await runManualEnrichment({ sessionId: "sess-789" });
    expect(mockSendCompletionNotification).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: runManualEnrichment — return value shape
// ══════════════════════════════════════════════════════════════════════════════

describe("runManualEnrichment — return value", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defaultMocks("sess-ret");
    delete process.env.SEND_MANUAL_ENRICHMENT_EMAIL;
  });

  test("returns an object with all expected top-level keys", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-ret" });
    expect(result).toHaveProperty("totalFound");
    expect(result).toHaveProperty("enrichedCount");
    expect(result).toHaveProperty("enrichmentFailed");
    expect(result).toHaveProperty("sessionsUpdated");
    expect(result).toHaveProperty("keywordsWithContent");
    expect(result).toHaveProperty("keywordsWithoutContent");
    expect(result).toHaveProperty("tokenUsage");
  });

  test("sessionsUpdated is an array and is empty when no articles found", async () => {
    prisma.scrapedArticle.findMany.mockResolvedValue([]);
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-ret" });
    expect(Array.isArray(result.sessionsUpdated)).toBe(true);
    expect(result.sessionsUpdated).toHaveLength(0);
  });

  test("tokenUsage has inputTokens, outputTokens, estimatedCostUSD", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-ret" });
    expect(result.tokenUsage).toHaveProperty("inputTokens");
    expect(result.tokenUsage).toHaveProperty("outputTokens");
    expect(result.tokenUsage).toHaveProperty("estimatedCostUSD");
  });

  test("estimatedCostUSD is a number (not NaN)", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-ret" });
    expect(typeof result.tokenUsage.estimatedCostUSD).toBe("number");
    expect(isNaN(result.tokenUsage.estimatedCostUSD)).toBe(false);
  });

  test("keywordsWithContent is an array", async () => {
    const { runManualEnrichment } = require("../../src/services/enrichment.service");
    const result = await runManualEnrichment({ sessionId: "sess-ret" });
    expect(Array.isArray(result.keywordsWithContent)).toBe(true);
  });
});