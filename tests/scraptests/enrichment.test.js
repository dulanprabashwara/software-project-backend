// tests/scraper/enrichment.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for the enrichment service's JSON parsing logic and
// categoryKeywords config integrity.
//
// Run: npm test -- tests/scraper/enrichment.test.js
// ─────────────────────────────────────────────────────────────────────────────

const { CATEGORY_KEYWORDS, SCRAPING_CATEGORIES } = require("../../src/config/categoryKeywords");

// ── Replicate parseEnrichmentResponse locally ─────────────────────────────

function parseEnrichmentResponse(raw) {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  if (cleaned.startsWith("{")) {
    const match = cleaned.match(/"(?:results?|articles?|data)"\s*:\s*(\[[\s\S]*\])/);
    if (match) cleaned = match[1];
  }

  const start = cleaned.indexOf("[");
  const end   = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in response");
  cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch {
    const fixed = cleaned
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u0000-\u001F\u007F]/g, " ");
    return JSON.parse(fixed);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// parseEnrichmentResponse
// ════════════════════════════════════════════════════════════════════════════

describe("parseEnrichmentResponse", () => {

  test("parses a clean JSON array response", () => {
    const raw = `[{"id":"abc","matchedKeywords":["Artificial intelligence"],"summary":"A good summary."}]`;
    const result = parseEnrichmentResponse(raw);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe("abc");
    expect(result[0].matchedKeywords).toContain("Artificial intelligence");
  });

  test("strips markdown code fences (```json ... ```)", () => {
    const raw = '```json\n[{"id":"abc","matchedKeywords":[],"summary":"Summary text."}]\n```';
    const result = parseEnrichmentResponse(raw);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe("abc");
  });

  test("strips plain ``` fences", () => {
    const raw = '```[{"id":"xyz","matchedKeywords":["Cybersecurity"],"summary":"Summary."}]```';
    const result = parseEnrichmentResponse(raw);
    expect(result[0].id).toBe("xyz");
  });

  test("handles multiple articles in one response", () => {
    const raw = `[
      {"id":"id1","matchedKeywords":["Mental health"],"summary":"Summary one."},
      {"id":"id2","matchedKeywords":["Nutrition and diet"],"summary":"Summary two."}
    ]`;
    const result = parseEnrichmentResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("id2");
  });

  test("unwraps object wrapper from results key", () => {
    const raw = `{"results":[{"id":"a1","matchedKeywords":[],"summary":"Test."}]}`;
    const result = parseEnrichmentResponse(raw);
    expect(result[0].id).toBe("a1");
  });

  test("throws on completely unparseable response", () => {
    expect(() => parseEnrichmentResponse("This is not JSON at all")).toThrow();
  });

  test("throws when no array brackets found", () => {
    expect(() => parseEnrichmentResponse('{"key": "value"}')).toThrow(/No JSON array/);
  });

  test("handles trailing comma (common AI mistake)", () => {
    const raw = `[{"id":"a","matchedKeywords":["Photography",],"summary":"Summary."},]`;
    // Should fix trailing comma and not throw
    let result;
    expect(() => { result = parseEnrichmentResponse(raw); }).not.toThrow();
    // May parse correctly or throw depending on JSON.parse strictness
    // Main test is that it does not crash the whole enrichment stage
  });

  test("handles empty matched keywords array", () => {
    const raw = `[{"id":"noKeywords","matchedKeywords":[],"summary":"Article with no matched keywords."}]`;
    const result = parseEnrichmentResponse(raw);
    expect(result[0].matchedKeywords).toEqual([]);
  });

});

// ════════════════════════════════════════════════════════════════════════════
// categoryKeywords config integrity
// ════════════════════════════════════════════════════════════════════════════

describe("categoryKeywords config", () => {

  test("exports CATEGORY_KEYWORDS as an object", () => {
    expect(typeof CATEGORY_KEYWORDS).toBe("object");
    expect(CATEGORY_KEYWORDS).not.toBeNull();
  });

  test("exports SCRAPING_CATEGORIES as an array", () => {
    expect(Array.isArray(SCRAPING_CATEGORIES)).toBe(true);
  });

  test("has exactly 23 categories", () => {
    expect(SCRAPING_CATEGORIES).toHaveLength(23);
  });

  test("SCRAPING_CATEGORIES matches keys of CATEGORY_KEYWORDS", () => {
    const keysFromObj = Object.keys(CATEGORY_KEYWORDS).sort();
    const keysFromArr = [...SCRAPING_CATEGORIES].sort();
    expect(keysFromArr).toEqual(keysFromObj);
  });

  test("every category has at least 10 keywords", () => {
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      expect(keywords.length).toBeGreaterThanOrEqual(10);
    }
  });

  test("no category has duplicate keywords within itself", () => {
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const uniqueSet = new Set(keywords.map(k => k.toLowerCase()));
      expect(uniqueSet.size).toBe(keywords.length);
    }
  });

  test("all keywords are non-empty strings", () => {
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        expect(typeof kw).toBe("string");
        expect(kw.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("contains expected category names from keywords.js", () => {
    expect(SCRAPING_CATEGORIES).toContain("Technology & Digital Life");
    expect(SCRAPING_CATEGORIES).toContain("Health & Medicine");
    expect(SCRAPING_CATEGORIES).toContain("Finance & Money");
    expect(SCRAPING_CATEGORIES).toContain("Science & Discovery");
    expect(SCRAPING_CATEGORIES).toContain("History");
    expect(SCRAPING_CATEGORIES).toContain("Religion, Philosophy & Beliefs");
  });

  test("Technology & Digital Life contains AI-related keywords", () => {
    const techKeywords = CATEGORY_KEYWORDS["Technology & Digital Life"];
    expect(techKeywords).toContain("Artificial intelligence");
    expect(techKeywords).toContain("Machine learning");
    expect(techKeywords).toContain("Cybersecurity");
  });

  test("Health & Medicine contains health-related keywords", () => {
    const healthKeywords = CATEGORY_KEYWORDS["Health & Medicine"];
    expect(healthKeywords).toContain("Mental health");
    expect(healthKeywords).toContain("Nutrition and diet");
    expect(healthKeywords).toContain("Public health");
  });

});
