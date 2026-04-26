// tests/scraptests/session_lifecycle.test.js
// Tests for session state transitions and failure-mode report building.
//
// Functions tested (inlined — no DB/HTTP dependencies):
//   buildPartialReport   — called when process receives SIGINT/SIGTERM/SIGHUP
//   buildCrashReport     — called when runScrapingSession throws unexpectedly
//
// What is NOT tested here:
//   Real OS signal delivery (cannot be automated in Jest)
//   Real DB writes during signal handling (covered by TC_LIFE_001/002 manual tests)
//   Real email delivery (nodemailer mocked in email.test.js)

// ── Replicate buildPartialReport and buildCrashReport locally ──────────────

function buildPartialReport(sessionId, startTime, config, counters) {
  const totalSuccess    = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
  const totalDuplicate  = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
  const totalFailure    = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
  const totalUrlsFound  = Object.values(counters).reduce((s, c) => s + c.urlsProcessed,  0);
  const durationMinutes = (Date.now() - startTime) / 60000;
  const attempted       = totalSuccess + totalFailure;

  return {
    sessionId,
    startedAt:              new Date(startTime).toISOString(),
    completedAt:            new Date().toISOString(),
    durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
    totalSources:           config?.totalSources || 0,
    totalUrlsFound,
    successCount:           totalSuccess,
    duplicateCount:         totalDuplicate,
    failureCount:           totalFailure,
    successRate:            attempted > 0 ? parseFloat(((totalSuccess / attempted) * 100).toFixed(2)) : null,
    enrichedCount:          0,
    enrichmentFailed:       0,
    keywordsWithContent:    [],
    keywordsWithoutContent: [],
    totalKeywordsCovered:   0,
    totalKeywordsEmpty:     0,
    aiTokenUsage:           { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
    criticalErrors:         true,
    isInterrupted:          true,
  };
}

function buildCrashReport(sessionId, startTime, config, counters, errorMessage) {
  const totalSuccess    = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
  const totalDuplicate  = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
  const totalFailure    = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
  const totalUrlsFound  = Object.values(counters).reduce((s, c) => s + c.urlsProcessed,  0);
  const durationMinutes = (Date.now() - startTime) / 60000;
  const attempted       = totalSuccess + totalFailure;

  return {
    sessionId,
    startedAt:              new Date(startTime).toISOString(),
    completedAt:            new Date().toISOString(),
    durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
    totalSources:           config?.totalSources || 0,
    totalUrlsFound,
    successCount:           totalSuccess,
    duplicateCount:         totalDuplicate,
    failureCount:           totalFailure,
    successRate:            attempted > 0 ? parseFloat(((totalSuccess / attempted) * 100).toFixed(2)) : null,
    enrichedCount:          0,
    enrichmentFailed:       0,
    keywordsWithContent:    [],
    keywordsWithoutContent: [],
    totalKeywordsCovered:   0,
    totalKeywordsEmpty:     0,
    aiTokenUsage:           { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
    criticalErrors:         true,
    isCrashed:              true,
    crashReason:            errorMessage,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCounters(overrides = {}) {
  return {
    "Technology & Digital Life": { successCount: 5, duplicateCount: 1, failureCount: 1, urlsProcessed: 7, ...overrides },
    "Health & Medicine":         { successCount: 3, duplicateCount: 0, failureCount: 2, urlsProcessed: 5 },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// buildPartialReport — SIGINT / SIGTERM / SIGHUP path (TC_LIFE_001, TC_LIFE_002)
// ════════════════════════════════════════════════════════════════════════════

describe("buildPartialReport — report shape when session is interrupted", () => {

  test("returns isInterrupted: true", () => {
    const report = buildPartialReport("sess-001", Date.now() - 5000, { totalSources: 4 }, makeCounters());
    expect(report.isInterrupted).toBe(true);
  });

  test("returns criticalErrors: true (interrupted session always signals an issue)", () => {
    const report = buildPartialReport("sess-001", Date.now() - 5000, { totalSources: 4 }, makeCounters());
    expect(report.criticalErrors).toBe(true);
  });

  test("does NOT set isCrashed — interrupted is different from crashed", () => {
    const report = buildPartialReport("sess-001", Date.now(), { totalSources: 4 }, makeCounters());
    expect(report.isCrashed).toBeUndefined();
  });

  test("sessionId matches the value passed in", () => {
    const report = buildPartialReport("sess-interrupted-999", Date.now(), { totalSources: 4 }, makeCounters());
    expect(report.sessionId).toBe("sess-interrupted-999");
  });

  test("successCount sums across all categories correctly", () => {
    const counters = {
      "Technology & Digital Life": { successCount: 5, duplicateCount: 1, failureCount: 1, urlsProcessed: 7 },
      "Health & Medicine":         { successCount: 3, duplicateCount: 0, failureCount: 2, urlsProcessed: 5 },
    };
    const report = buildPartialReport("sess", Date.now(), { totalSources: 4 }, counters);
    expect(report.successCount).toBe(8);    // 5+3
    expect(report.duplicateCount).toBe(1);  // 1+0
    expect(report.failureCount).toBe(3);    // 1+2
    expect(report.totalUrlsFound).toBe(12); // 7+5
  });

  test("successRate is calculated from successCount / (success + failure)", () => {
    const counters = {
      "Cat A": { successCount: 8, duplicateCount: 0, failureCount: 2, urlsProcessed: 10 },
    };
    const report = buildPartialReport("sess", Date.now(), { totalSources: 1 }, counters);
    expect(report.successRate).toBe(80); // 8/(8+2) = 80%
  });

  test("successRate is null when no articles were attempted (zero success + zero failure)", () => {
    const counters = {
      "Cat A": { successCount: 0, duplicateCount: 5, failureCount: 0, urlsProcessed: 5 },
    };
    const report = buildPartialReport("sess", Date.now(), { totalSources: 1 }, counters);
    expect(report.successRate).toBeNull();
  });

  test("enrichedCount is 0 — enrichment never runs on an interrupted session", () => {
    const report = buildPartialReport("sess", Date.now(), { totalSources: 4 }, makeCounters());
    expect(report.enrichedCount).toBe(0);
    expect(report.enrichmentFailed).toBe(0);
  });

  test("aiTokenUsage is all zeros — no enrichment calls were made", () => {
    const report = buildPartialReport("sess", Date.now(), { totalSources: 4 }, makeCounters());
    expect(report.aiTokenUsage.inputTokens).toBe(0);
    expect(report.aiTokenUsage.outputTokens).toBe(0);
    expect(report.aiTokenUsage.estimatedCostUSD).toBe(0);
  });

  test("durationMinutes is positive and reflects time since startTime", () => {
    const startTime = Date.now() - 3 * 60 * 1000; // 3 minutes ago
    const report    = buildPartialReport("sess", startTime, { totalSources: 4 }, makeCounters());
    expect(report.durationMinutes).toBeGreaterThan(2.9);
    expect(report.durationMinutes).toBeLessThan(3.1);
  });

  test("totalSources comes from config.totalSources", () => {
    const report = buildPartialReport("sess", Date.now(), { totalSources: 12 }, makeCounters());
    expect(report.totalSources).toBe(12);
  });

  test("totalSources defaults to 0 when config is null (killed before Phase 1 complete)", () => {
    const report = buildPartialReport("sess", Date.now(), null, makeCounters());
    expect(report.totalSources).toBe(0);
  });

  test("startedAt is a valid ISO string matching startTime", () => {
    const startTime = Date.now() - 10000;
    const report    = buildPartialReport("sess", startTime, { totalSources: 1 }, makeCounters());
    expect(() => new Date(report.startedAt)).not.toThrow();
    expect(new Date(report.startedAt).getTime()).toBeCloseTo(startTime, -2);
  });

  test("completedAt is a valid ISO string close to now", () => {
    const before = Date.now();
    const report  = buildPartialReport("sess", before - 5000, { totalSources: 1 }, makeCounters());
    const after   = Date.now();
    const completedTs = new Date(report.completedAt).getTime();
    expect(completedTs).toBeGreaterThanOrEqual(before);
    expect(completedTs).toBeLessThanOrEqual(after + 100);
  });

  test("handles empty counters object gracefully (session killed before any category processed)", () => {
    const report = buildPartialReport("sess", Date.now(), { totalSources: 4 }, {});
    expect(report.successCount).toBe(0);
    expect(report.failureCount).toBe(0);
    expect(report.totalUrlsFound).toBe(0);
    expect(report.successRate).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildCrashReport — unhandled error path (TC_LIFE_004)
// ════════════════════════════════════════════════════════════════════════════

describe("buildCrashReport — report shape when session crashes", () => {

  test("returns isCrashed: true", () => {
    const report = buildCrashReport("sess-crash", Date.now() - 1000, { totalSources: 4 }, makeCounters(), "DB connection lost");
    expect(report.isCrashed).toBe(true);
  });

  test("returns criticalErrors: true", () => {
    const report = buildCrashReport("sess", Date.now(), { totalSources: 4 }, makeCounters(), "Error");
    expect(report.criticalErrors).toBe(true);
  });

  test("does NOT set isInterrupted — crash is different from user-initiated interrupt", () => {
    const report = buildCrashReport("sess", Date.now(), { totalSources: 4 }, makeCounters(), "Error");
    expect(report.isInterrupted).toBeUndefined();
  });

  test("crashReason matches the error message passed in", () => {
    const report = buildCrashReport("sess", Date.now(), { totalSources: 4 }, makeCounters(), "Cannot read properties of undefined");
    expect(report.crashReason).toBe("Cannot read properties of undefined");
  });

  test("crashReason is stored for display in the email crash banner", () => {
    const errorMsg = "NeonDB connection timeout after 30000ms";
    const report   = buildCrashReport("sess", Date.now(), { totalSources: 4 }, makeCounters(), errorMsg);
    expect(report.crashReason).toBe(errorMsg);
  });

  test("successCount and failureCount reflect partial work done before the crash", () => {
    const counters = {
      "Technology & Digital Life": { successCount: 4, duplicateCount: 1, failureCount: 2, urlsProcessed: 7 },
      "Health & Medicine":         { successCount: 0, duplicateCount: 0, failureCount: 0, urlsProcessed: 0 }, // not processed yet
    };
    const report = buildCrashReport("sess", Date.now(), { totalSources: 4 }, counters, "Crash mid-way");
    expect(report.successCount).toBe(4);
    expect(report.failureCount).toBe(2);
  });

  test("sessionId, totalSources, durationMinutes, startedAt, completedAt all populated", () => {
    const startTime = Date.now() - 2 * 60 * 1000;
    const report    = buildCrashReport("sess-xyz", startTime, { totalSources: 8 }, makeCounters(), "err");
    expect(report.sessionId).toBe("sess-xyz");
    expect(report.totalSources).toBe(8);
    expect(report.durationMinutes).toBeGreaterThan(1.9);
    expect(typeof report.startedAt).toBe("string");
    expect(typeof report.completedAt).toBe("string");
  });

  test("enrichedCount is 0 — crash prevents Phase 3 from running", () => {
    const report = buildCrashReport("sess", Date.now(), { totalSources: 4 }, makeCounters(), "err");
    expect(report.enrichedCount).toBe(0);
    expect(report.enrichmentFailed).toBe(0);
  });

  test("handles empty counters — crash before any scraping started", () => {
    const report = buildCrashReport("sess", Date.now(), { totalSources: 4 }, {}, "DB down before Phase 2");
    expect(report.successCount).toBe(0);
    expect(report.totalUrlsFound).toBe(0);
    expect(report.isCrashed).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Distinguishing interrupted vs crashed — both used in email.service.js
// ════════════════════════════════════════════════════════════════════════════

describe("partial vs crash report distinction", () => {

  test("only partial report has isInterrupted: true", () => {
    const partial = buildPartialReport("s", Date.now(), { totalSources: 1 }, makeCounters());
    const crash   = buildCrashReport("s", Date.now(), { totalSources: 1 }, makeCounters(), "err");
    expect(partial.isInterrupted).toBe(true);
    expect(crash.isInterrupted).toBeUndefined();
  });

  test("only crash report has isCrashed: true", () => {
    const partial = buildPartialReport("s", Date.now(), { totalSources: 1 }, makeCounters());
    const crash   = buildCrashReport("s", Date.now(), { totalSources: 1 }, makeCounters(), "err");
    expect(crash.isCrashed).toBe(true);
    expect(partial.isCrashed).toBeUndefined();
  });

  test("only crash report has crashReason field", () => {
    const partial = buildPartialReport("s", Date.now(), { totalSources: 1 }, makeCounters());
    const crash   = buildCrashReport("s", Date.now(), { totalSources: 1 }, makeCounters(), "boom");
    expect(crash.crashReason).toBe("boom");
    expect(partial.crashReason).toBeUndefined();
  });

  test("both always have criticalErrors: true", () => {
    const partial = buildPartialReport("s", Date.now(), { totalSources: 1 }, makeCounters());
    const crash   = buildCrashReport("s", Date.now(), { totalSources: 1 }, makeCounters(), "err");
    expect(partial.criticalErrors).toBe(true);
    expect(crash.criticalErrors).toBe(true);
  });
});
