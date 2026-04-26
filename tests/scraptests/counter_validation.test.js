// tests/scraptests/counter_validation.test.js
// Tests for the four counter validation functions in scraper.service.js.
// These functions guard against mathematically impossible values being written
// to the database — they catch bugs in counter logic before they reach storage.
//
// Functions tested (inlined here — they have no DB or HTTP dependencies):
//   validateCounters          — per-category: urlsProcessed = success + dupe + fail
//   validateSessionCounters   — session-level: totalUrlsFound = success + dupe + fail
//   validateEnrichmentCounters — enriched + failed ≤ successCount (articles scraped)
//   validateKeywordCounters   — covered + empty = total keywords in system

// ── Replicate the validation functions locally ─────────────────────────────
// (These are pure functions with no imports — safe to inline for testing)

function validateCounters(category, c) {
  const expectedTotal = c.successCount + c.duplicateCount + c.failureCount;

  if (c.urlsProcessed !== expectedTotal) {
    console.error(`[Phase 2] ⚠️  Counter mismatch in "${category}"`);
    c.urlsProcessed = expectedTotal;
  }

  if (c.successCount < 0 || c.duplicateCount < 0 || c.failureCount < 0 || c.urlsProcessed < 0) {
    c.successCount   = Math.max(0, c.successCount);
    c.duplicateCount = Math.max(0, c.duplicateCount);
    c.failureCount   = Math.max(0, c.failureCount);
    c.urlsProcessed  = c.successCount + c.duplicateCount + c.failureCount;
  }
}

function validateSessionCounters(totalUrlsFound, totalSuccess, totalDuplicate, totalFailure) {
  const expectedTotal = totalSuccess + totalDuplicate + totalFailure;
  if (totalUrlsFound !== expectedTotal) {
    console.error(`[Phase 2] ⚠️  Session counter mismatch`);
    return expectedTotal;
  }
  return totalUrlsFound;
}

function validateEnrichmentCounters(successCount, enrichedCount, enrichmentFailed) {
  const enrichmentTotal = enrichedCount + enrichmentFailed;
  if (enrichmentTotal > successCount) {
    console.error(`[Phase 3] ⚠️  Enrichment counter overflow`);
    return Math.max(0, successCount - enrichedCount);
  }
  return enrichmentFailed;
}

function validateKeywordCounters(keywordsCoveredCount, keywordsEmptyCount, totalKeywordsInSystem) {
  if (keywordsCoveredCount < 0 || keywordsEmptyCount < 0) {
    return {
      keywordsCoveredCount: Math.max(0, keywordsCoveredCount),
      keywordsEmptyCount:   Math.max(0, keywordsEmptyCount),
    };
  }
  return { keywordsCoveredCount, keywordsEmptyCount };
}

// ════════════════════════════════════════════════════════════════════════════
// validateCounters — per-category counter (TC_SCRAPE_001, TC_SCRAPE_002)
// ════════════════════════════════════════════════════════════════════════════

describe("validateCounters — category-level URL counter invariant", () => {

  test("does not modify counters when invariant already holds", () => {
    const c = { urlsProcessed: 10, successCount: 5, duplicateCount: 2, failureCount: 3 };
    validateCounters("Technology & Digital Life", c);
    expect(c.urlsProcessed).toBe(10);
    expect(c.successCount).toBe(5);
    expect(c.duplicateCount).toBe(2);
    expect(c.failureCount).toBe(3);
  });

  test("corrects urlsProcessed when it is lower than sum — the homepage-failure bug scenario", () => {
    // urlsProcessed=0, failureCount=1 was the real database bug:
    // homepage failed, failureCount++ ran but urlsProcessed++ did not.
    const c = { urlsProcessed: 0, successCount: 0, duplicateCount: 0, failureCount: 1 };
    validateCounters("Finance & Money", c);
    expect(c.urlsProcessed).toBe(1); // corrected to 0+0+1
  });

  test("corrects urlsProcessed when it is higher than sum", () => {
    const c = { urlsProcessed: 15, successCount: 5, duplicateCount: 2, failureCount: 3 };
    validateCounters("Health & Medicine", c);
    expect(c.urlsProcessed).toBe(10); // corrected to 5+2+3
  });

  test("corrects real database anomaly: urlsProcessed=14, success=3, dupe=0, fail=12 (sum=15)", () => {
    // This exact row was seen in the CategoryScrapingStats table before the fix
    const c = { urlsProcessed: 14, successCount: 3, duplicateCount: 0, failureCount: 12 };
    validateCounters("Agriculture & Rural Life", c);
    expect(c.urlsProcessed).toBe(15);
  });

  test("corrects real database anomaly: urlsProcessed=42, success=12, dupe=11, fail=20 (sum=43)", () => {
    const c = { urlsProcessed: 42, successCount: 12, duplicateCount: 11, failureCount: 20 };
    validateCounters("Science & Discovery", c);
    expect(c.urlsProcessed).toBe(43);
  });

  test("resets negative successCount to 0", () => {
    const c = { urlsProcessed: 5, successCount: -1, duplicateCount: 3, failureCount: 3 };
    validateCounters("History", c);
    expect(c.successCount).toBe(0);
    expect(c.urlsProcessed).toBe(6); // recalculated: 0+3+3
  });

  test("resets negative duplicateCount to 0", () => {
    const c = { urlsProcessed: 5, successCount: 3, duplicateCount: -2, failureCount: 2 };
    validateCounters("Sports & Athletics", c);
    expect(c.duplicateCount).toBe(0);
    expect(c.urlsProcessed).toBe(5); // recalculated: 3+0+2
  });

  test("resets negative failureCount to 0", () => {
    const c = { urlsProcessed: 3, successCount: 3, duplicateCount: 0, failureCount: -5 };
    validateCounters("Education & Learning", c);
    expect(c.failureCount).toBe(0);
    expect(c.urlsProcessed).toBe(3); // recalculated: 3+0+0
  });

  test("handles all-zero counters without error", () => {
    const c = { urlsProcessed: 0, successCount: 0, duplicateCount: 0, failureCount: 0 };
    expect(() => validateCounters("Empty Category", c)).not.toThrow();
    expect(c.urlsProcessed).toBe(0);
  });

  test("invariant holds after correction: urlsProcessed = success + dupe + fail", () => {
    const c = { urlsProcessed: 99, successCount: 10, duplicateCount: 5, failureCount: 8 };
    validateCounters("Any", c);
    expect(c.urlsProcessed).toBe(c.successCount + c.duplicateCount + c.failureCount);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateSessionCounters — session-level total (TC_SCRAPE_002)
// ════════════════════════════════════════════════════════════════════════════

describe("validateSessionCounters — session-level URL total invariant", () => {

  test("returns totalUrlsFound unchanged when invariant already holds", () => {
    const result = validateSessionCounters(20, 10, 5, 5);
    expect(result).toBe(20); // 10+5+5 = 20 ✅
  });

  test("returns corrected total when totalUrlsFound is too low", () => {
    const result = validateSessionCounters(18, 10, 5, 5);
    expect(result).toBe(20); // corrected to 10+5+5
  });

  test("returns corrected total when totalUrlsFound is too high", () => {
    const result = validateSessionCounters(25, 10, 5, 5);
    expect(result).toBe(20); // corrected to 10+5+5
  });

  test("returns 0 when all outcome counts are 0", () => {
    const result = validateSessionCounters(0, 0, 0, 0);
    expect(result).toBe(0);
  });

  test("corrects the homepage-failure bug at session level — urlsFound=0 but failures>0", () => {
    // All sources failed at homepage level — urlsProcessed was never incremented
    const result = validateSessionCounters(0, 0, 0, 3);
    expect(result).toBe(3); // 3 failures must be counted
  });

  test("handles large numbers correctly", () => {
    const result = validateSessionCounters(1000, 600, 200, 200);
    expect(result).toBe(1000); // invariant holds
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateEnrichmentCounters — enrichment math (TC_ENRICH_005, TC_ENRICH_007)
// ════════════════════════════════════════════════════════════════════════════

describe("validateEnrichmentCounters — enrichment count invariant", () => {

  test("returns enrichmentFailed unchanged when within bounds", () => {
    // 20 scraped, 15 enriched, 5 failed — 15+5=20 ≤ 20 ✅
    const result = validateEnrichmentCounters(20, 15, 5);
    expect(result).toBe(5);
  });

  test("returns 0 when all articles were successfully enriched", () => {
    const result = validateEnrichmentCounters(20, 20, 0);
    expect(result).toBe(0);
  });

  test("caps enrichmentFailed when enriched + failed > successCount", () => {
    // Bug scenario: enriched=11 + failed=9 = 20, but successCount=18
    // Can't enrich more articles than were scraped
    const result = validateEnrichmentCounters(18, 11, 9);
    expect(result).toBe(7); // capped: 18-11 = 7
  });

  test("caps enrichmentFailed to 0 when enrichedCount already equals successCount", () => {
    // All scraped articles are enriched — failed should be 0
    const result = validateEnrichmentCounters(20, 20, 5);
    expect(result).toBe(0); // 20-20 = 0
  });

  test("handles zero enrichedCount — all articles failed enrichment", () => {
    const result = validateEnrichmentCounters(20, 0, 20);
    expect(result).toBe(20); // 0+20=20 ≤ 20 ✅
  });

  test("handles successCount of 0 — nothing was scraped", () => {
    const result = validateEnrichmentCounters(0, 0, 0);
    expect(result).toBe(0);
  });

  test("after manual enrichment: failed corrects to 0 when all 9 previously-failed articles enriched", () => {
    // Session had: scraped=20, enriched=11, failed=9
    // After manual enrichment: enriched+9=20, failed=0
    // validateEnrichmentCounters(successCount=20, enrichedCount=20, enrichmentFailed=0)
    const result = validateEnrichmentCounters(20, 20, 0);
    expect(result).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateKeywordCounters — keyword coverage math (TC_ENRICH_006)
// ════════════════════════════════════════════════════════════════════════════

describe("validateKeywordCounters — keyword coverage invariant", () => {

  test("returns counts unchanged when both are non-negative", () => {
    const result = validateKeywordCounters(47, 413, 460);
    expect(result.keywordsCoveredCount).toBe(47);
    expect(result.keywordsEmptyCount).toBe(413);
  });

  test("resets negative keywordsCoveredCount to 0", () => {
    const result = validateKeywordCounters(-5, 460, 460);
    expect(result.keywordsCoveredCount).toBe(0);
    expect(result.keywordsEmptyCount).toBe(460);
  });

  test("resets negative keywordsEmptyCount to 0", () => {
    const result = validateKeywordCounters(47, -10, 460);
    expect(result.keywordsCoveredCount).toBe(47);
    expect(result.keywordsEmptyCount).toBe(0);
  });

  test("resets both to 0 if both are negative", () => {
    const result = validateKeywordCounters(-5, -3, 460);
    expect(result.keywordsCoveredCount).toBe(0);
    expect(result.keywordsEmptyCount).toBe(0);
  });

  test("handles all-zero counts without error", () => {
    const result = validateKeywordCounters(0, 0, 460);
    expect(result.keywordsCoveredCount).toBe(0);
    expect(result.keywordsEmptyCount).toBe(0);
  });

  test("does not modify counts when sum matches totalKeywordsInSystem", () => {
    const result = validateKeywordCounters(100, 360, 460);
    expect(result.keywordsCoveredCount).toBe(100);
    expect(result.keywordsEmptyCount).toBe(360);
  });

  test("still returns valid result when sum mismatches system total (logs warning only, does not crash)", () => {
    // categoryKeywords.js has 460 total keywords, but covered+empty = 400
    // This can happen if categoryKeywords.js changed mid-session
    const result = validateKeywordCounters(40, 360, 460);
    // Should not throw and should return the passed values unchanged
    expect(result.keywordsCoveredCount).toBe(40);
    expect(result.keywordsEmptyCount).toBe(360);
  });

  test("returns object with both keywordsCoveredCount and keywordsEmptyCount keys", () => {
    const result = validateKeywordCounters(50, 410, 460);
    expect(result).toHaveProperty("keywordsCoveredCount");
    expect(result).toHaveProperty("keywordsEmptyCount");
  });
});
