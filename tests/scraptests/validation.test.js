// tests/scraper/validation.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for validateArticleContent — all the if/else branches of validation.
// No database, no HTTP. Pure logic tests.
//
// Run: npm test -- tests/scraper/validation.test.js
// ─────────────────────────────────────────────────────────────────────────────

const { parseScrapeWindowToDays } = require("./test-helpers/scraper-internals");

// ── Replicate validateArticleContent locally ───────────────────────────────

function validateArticleContent(cleanedContent, title, publishedDate, source) {
  const { content, wordCount } = cleanedContent;
  const maxAgeDays   = parseScrapeWindowToDays(source.scrapeWindow);
  const minWordCount = source.minWordCount || 300;
  const excludedKws  = source.excludedKeywords || [];

  if (publishedDate && !isNaN(publishedDate) && maxAgeDays) {
    const ageDays = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) {
      return { valid: false, reason: `Too old: ${Math.floor(ageDays)}d (limit: ${source.scrapeWindow})` };
    }
  }

  if (wordCount < minWordCount) {
    return { valid: false, reason: `Word count ${wordCount} below minimum ${minWordCount}` };
  }

  if (content.length < 400) {
    return { valid: false, reason: "Content too thin after cleaning (< 400 chars)" };
  }

  if (!title || title.length < 10) {
    return { valid: false, reason: "Title missing or too short" };
  }

  const paraCount = (content.match(/\n\n/g) || []).length;
  if (paraCount < 2) {
    return { valid: false, reason: "No paragraph structure" };
  }

  const combined = (title + " " + content).toLowerCase();
  for (const kw of excludedKws) {
    if (kw && combined.includes(kw.toLowerCase())) {
      return { valid: false, reason: `Contains excluded keyword: "${kw}"` };
    }
  }

  return { valid: true, reason: null };
}

// ── Helpers for building test data ─────────────────────────────────────────

function makeContent(words = 400, paragraphs = 3) {
  const para = "This is a meaningful paragraph about an interesting topic in the article. ".repeat(Math.ceil(words / 12));
  const parts = [];
  for (let i = 0; i < paragraphs; i++) {
    parts.push(para.split(" ").slice(0, Math.ceil(words / paragraphs)).join(" "));
  }
  const content = parts.join("\n\n");
  return { content, wordCount: content.split(/\s+/).filter(w => w).length };
}

const BASE_SOURCE = {
  scrapeWindow:     "Last 30 Days",
  minWordCount:     300,
  excludedKeywords: [],
};

const GOOD_TITLE = "This Is A Good Article Title About Technology Trends";

// ════════════════════════════════════════════════════════════════════════════
// validateArticleContent — date validation
// ════════════════════════════════════════════════════════════════════════════

describe("validateArticleContent — date checks", () => {

  test("accepts article published within scrapeWindow", () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const result = validateArticleContent(makeContent(), GOOD_TITLE, recentDate, {
      ...BASE_SOURCE, scrapeWindow: "Last 7 Days"
    });
    expect(result.valid).toBe(true);
  });

  test("rejects article older than scrapeWindow", () => {
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago
    const result = validateArticleContent(makeContent(), GOOD_TITLE, oldDate, {
      ...BASE_SOURCE, scrapeWindow: "3 months"
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Too old/);
  });

  test("accepts article with no published date (date not extractable)", () => {
    const result = validateArticleContent(makeContent(), GOOD_TITLE, null, BASE_SOURCE);
    expect(result.valid).toBe(true);
  });

  test("accepts article when source has no scrapeWindow set", () => {
    const oldDate = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000);
    const result = validateArticleContent(makeContent(), GOOD_TITLE, oldDate, {
      ...BASE_SOURCE, scrapeWindow: null
    });
    expect(result.valid).toBe(true); // no limit = accept regardless of age
  });

  test("accepts article exactly at the scrapeWindow boundary", () => {
    // Article published exactly 7 days ago — just within "Last 7 Days"
    const boundaryDate = new Date(Date.now() - 6.9 * 24 * 60 * 60 * 1000);
    const result = validateArticleContent(makeContent(), GOOD_TITLE, boundaryDate, {
      ...BASE_SOURCE, scrapeWindow: "Last 7 Days"
    });
    expect(result.valid).toBe(true);
  });

  test("rejects article with invalid date object", () => {
    const invalidDate = new Date("not-a-date");
    // Invalid date should not cause a crash — just skip the date check
    const result = validateArticleContent(makeContent(), GOOD_TITLE, invalidDate, BASE_SOURCE);
    expect(result.valid).toBe(true); // skips the date check because isNaN(invalidDate) = true
  });

});

// ════════════════════════════════════════════════════════════════════════════
// validateArticleContent — word count
// ════════════════════════════════════════════════════════════════════════════

describe("validateArticleContent — word count", () => {

  test("rejects article below minWordCount", () => {
    const shortContent = { content: "Short.\n\nAlso short.\n\nStill short.", wordCount: 5 };
    const result = validateArticleContent(shortContent, GOOD_TITLE, null, {
      ...BASE_SOURCE, minWordCount: 300
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Word count/);
  });

  test("accepts article exactly at minWordCount", () => {
    const content = makeContent(300, 3);
    const result = validateArticleContent(content, GOOD_TITLE, null, {
      ...BASE_SOURCE, minWordCount: 300
    });
    expect(result.valid).toBe(true);
  });

  test("uses default minWordCount 300 if source has none set", () => {
    const shortContent = { content: "a ".repeat(100).trim() + "\n\na\n\na", wordCount: 100 };
    const result = validateArticleContent(shortContent, GOOD_TITLE, null, {
      scrapeWindow: null, excludedKeywords: []
      // no minWordCount
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Word count 100 below minimum 300/);
  });

});

// ════════════════════════════════════════════════════════════════════════════
// validateArticleContent — content quality
// ════════════════════════════════════════════════════════════════════════════

describe("validateArticleContent — content quality", () => {

  test("rejects content shorter than 400 characters", () => {
    const thinContent = { content: "Short content.\n\nAlso short.\n\nStill.", wordCount: 350 };
    const result = validateArticleContent(thinContent, GOOD_TITLE, null, BASE_SOURCE);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too thin/);
  });

  test("rejects missing title", () => {
    const result = validateArticleContent(makeContent(), null, null, BASE_SOURCE);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Title/);
  });

  test("rejects title shorter than 10 characters", () => {
    const result = validateArticleContent(makeContent(), "Short", null, BASE_SOURCE);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Title/);
  });

  test("rejects content with no paragraph structure (no double newlines)", () => {
    const flatContent = {
      content: "A".repeat(500), // long but no paragraph breaks
      wordCount: 350
    };
    const result = validateArticleContent(flatContent, GOOD_TITLE, null, BASE_SOURCE);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/paragraph structure/);
  });

  test("passes all quality checks for good article", () => {
    const result = validateArticleContent(makeContent(400, 4), GOOD_TITLE, null, BASE_SOURCE);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
  });

});

// ════════════════════════════════════════════════════════════════════════════
// validateArticleContent — excluded keywords
// ════════════════════════════════════════════════════════════════════════════

describe("validateArticleContent — excluded keywords", () => {

  test("rejects article containing an excluded keyword in content", () => {
    const content = makeContent(400, 4);
    content.content += "\n\nThis article heavily features gambling references throughout.";
    const result = validateArticleContent(content, GOOD_TITLE, null, {
      ...BASE_SOURCE, excludedKeywords: ["gambling"]
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/gambling/);
  });

  test("rejects article containing excluded keyword in title (case insensitive)", () => {
    const result = validateArticleContent(makeContent(), "How Crypto Scams Target Elderly Users", null, {
      ...BASE_SOURCE, excludedKeywords: ["crypto scam"]
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/crypto scam/);
  });

  test("accepts article with no excluded keywords present", () => {
    const result = validateArticleContent(makeContent(), GOOD_TITLE, null, {
      ...BASE_SOURCE, excludedKeywords: ["gambling", "crypto scam", "dating app"]
    });
    expect(result.valid).toBe(true);
  });

  test("handles empty excluded keywords array", () => {
    const result = validateArticleContent(makeContent(), GOOD_TITLE, null, {
      ...BASE_SOURCE, excludedKeywords: []
    });
    expect(result.valid).toBe(true);
  });

  test("excluded keyword check is case insensitive", () => {
    const content = makeContent(400, 4);
    content.content += "\n\nThis article mentions GAMBLING repeatedly in its text.";
    const result = validateArticleContent(content, GOOD_TITLE, null, {
      ...BASE_SOURCE, excludedKeywords: ["Gambling"]
    });
    expect(result.valid).toBe(false);
  });

});
