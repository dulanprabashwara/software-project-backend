// tests/scraper/utils.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for pure utility functions inside scraper.service.js
// These functions have NO database calls and NO HTTP calls.
// They are imported by extracting them — we test the logic in isolation.
//
// Run: npm test -- tests/scraper/utils.test.js
// ─────────────────────────────────────────────────────────────────────────────

// We expose the internal functions for testing by temporarily setting
// module.exports inside the service. Since they aren't exported normally,
// we test them through a small re-export file that exists only for tests.
// See tests/scraper/test-helpers/scraper-internals.js

const {
  parseScrapeWindowToDays,
  countWords,
} = require("./test-helpers/scraper-internals");

// ════════════════════════════════════════════════════════════════════════════
// parseScrapeWindowToDays
// ════════════════════════════════════════════════════════════════════════════

describe("parseScrapeWindowToDays", () => {

  test("Last 24 Hours → 1 day", () => {
    expect(parseScrapeWindowToDays("Last 24 Hours")).toBe(1);
  });

  test("Last 7 Days → 7 days", () => {
    expect(parseScrapeWindowToDays("Last 7 Days")).toBe(7);
  });

  test("Last 30 Days → 30 days", () => {
    expect(parseScrapeWindowToDays("Last 30 Days")).toBe(30);
  });

  test("3 months → 90 days", () => {
    expect(parseScrapeWindowToDays("3 months")).toBe(90);
  });

  test("6 months → 180 days", () => {
    expect(parseScrapeWindowToDays("6 months")).toBe(180);
  });

  test("1 year → 365 days", () => {
    expect(parseScrapeWindowToDays("1 year")).toBe(365);
  });

  test("null input → returns null (no age limit)", () => {
    expect(parseScrapeWindowToDays(null)).toBeNull();
  });

  test("undefined input → returns null", () => {
    expect(parseScrapeWindowToDays(undefined)).toBeNull();
  });

  test("empty string → returns null", () => {
    expect(parseScrapeWindowToDays("")).toBeNull();
  });

  test("unknown value → returns null (no limit applied)", () => {
    expect(parseScrapeWindowToDays("fortnightly")).toBeNull();
  });

  test("case insensitive — 'last 7 days' works", () => {
    expect(parseScrapeWindowToDays("last 7 days")).toBe(7);
  });

  test("flexible: '14 days' → 14", () => {
    expect(parseScrapeWindowToDays("14 days")).toBe(14);
  });

  test("flexible: '2 months' → 60", () => {
    expect(parseScrapeWindowToDays("2 months")).toBe(60);
  });

  test("flexible: '2 years' → 730", () => {
    expect(parseScrapeWindowToDays("2 years")).toBe(730);
  });

});

// ════════════════════════════════════════════════════════════════════════════
// countWords
// ════════════════════════════════════════════════════════════════════════════

describe("countWords", () => {

  test("counts words in a normal sentence", () => {
    expect(countWords("The quick brown fox jumps")).toBe(5);
  });

  test("handles multiple spaces between words", () => {
    expect(countWords("hello   world")).toBe(2);
  });

  test("handles leading and trailing spaces", () => {
    expect(countWords("  hello world  ")).toBe(2);
  });

  test("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  test("returns 0 for whitespace-only string", () => {
    expect(countWords("   ")).toBe(0);
  });

  test("handles newlines as word separators", () => {
    expect(countWords("word1\nword2\nword3")).toBe(3);
  });

  test("counts a single word correctly", () => {
    expect(countWords("hello")).toBe(1);
  });

});
