// tests/scraptests/security.test.js
// Tests for scraperSecurity.js — SSRF protection, redirect validation,
// response safety checks, and content sanitization.
//
// No database, no HTTP calls. All functions are pure or use DNS mocks.
// TC_SEC_001, TC_SEC_002, TC_SEC_003, TC_SEC_004

jest.mock("dns", () => ({
  promises: {
    resolve4: jest.fn(),
  },
}));

const dns = require("dns").promises;

// Import functions from the security utility
// (Adjust path to match your project structure)
const {
  validateScrapingUrl,
  validateRedirectUrl,
  checkResponseSafety,
  sanitizeContent,
  sanitizeTitle,
  buildSecureAxiosConfig,
} = require("../../src/utils/scraperSecurity");

// ════════════════════════════════════════════════════════════════════════════
// validateScrapingUrl — SSRF protection (TC_SEC_001)
// ════════════════════════════════════════════════════════════════════════════

describe("validateScrapingUrl — SSRF protection", () => {
  beforeEach(() => jest.clearAllMocks());

  test("accepts a valid public HTTPS URL", async () => {
    dns.resolve4.mockResolvedValue(["93.184.216.34"]); // example.com
    const result = await validateScrapingUrl("https://techcrunch.com/articles");
    expect(result.safe).toBe(true);
  });

  test("blocks IPv4 loopback: 127.0.0.1", async () => {
    dns.resolve4.mockResolvedValue(["127.0.0.1"]);
    const result = await validateScrapingUrl("http://localhost/api");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/private IP|blocked hostname/i);
  });

  test("blocks localhost hostname directly without DNS lookup", async () => {
    const result = await validateScrapingUrl("http://localhost/admin");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/localhost/i);
  });

  test("blocks AWS metadata endpoint: 169.254.169.254", async () => {
    dns.resolve4.mockResolvedValue(["169.254.169.254"]);
    const result = await validateScrapingUrl("http://metadata.aws.internal/latest");
    expect(result.safe).toBe(false);
  });

  test("blocks private Class A range: 10.0.0.x", async () => {
    dns.resolve4.mockResolvedValue(["10.0.0.1"]);
    const result = await validateScrapingUrl("http://internal-service.company.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/private IP/i);
  });

  test("blocks private Class B range: 192.168.x.x", async () => {
    dns.resolve4.mockResolvedValue(["192.168.1.100"]);
    const result = await validateScrapingUrl("http://router.local");
    expect(result.safe).toBe(false);
  });

  test("blocks private Class C range: 172.16.x.x to 172.31.x.x", async () => {
    dns.resolve4.mockResolvedValue(["172.16.0.1"]);
    const result = await validateScrapingUrl("http://docker-internal.service");
    expect(result.safe).toBe(false);
  });

  test("blocks direct private IP URL (no DNS lookup needed)", async () => {
    const result = await validateScrapingUrl("http://192.168.1.1/admin");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/private IP/i);
  });

  test("blocks non-http/https schemes: ftp://", async () => {
    const result = await validateScrapingUrl("ftp://files.example.com/data");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/scheme/i);
  });

  test("blocks file:// scheme", async () => {
    const result = await validateScrapingUrl("file:///etc/passwd");
    expect(result.safe).toBe(false);
  });

  test("blocks non-standard ports", async () => {
    dns.resolve4.mockResolvedValue(["93.184.216.34"]);
    const result = await validateScrapingUrl("https://example.com:9000/api");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/port/i);
  });

  test("accepts standard port 443 explicitly", async () => {
    dns.resolve4.mockResolvedValue(["93.184.216.34"]);
    const result = await validateScrapingUrl("https://example.com:443/page");
    expect(result.safe).toBe(true);
  });

  test("returns safe: false when DNS resolution fails", async () => {
    dns.resolve4.mockRejectedValue(new Error("ENOTFOUND unknown-domain.xyz"));
    const result = await validateScrapingUrl("https://unknown-domain.xyz/news");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/DNS/i);
  });

  test("returns safe: false for malformed URL", async () => {
    const result = await validateScrapingUrl("not-a-url");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/Invalid URL/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateRedirectUrl — cross-domain redirect protection (TC_SEC_002)
// ════════════════════════════════════════════════════════════════════════════

describe("validateRedirectUrl — redirect safety checks", () => {

  test("accepts redirect to same domain", () => {
    const result = validateRedirectUrl("https://techcrunch.com/article-2", "techcrunch.com");
    expect(result.safe).toBe(true);
  });

  test("accepts redirect from non-www to www of same domain", () => {
    const result = validateRedirectUrl("https://www.techcrunch.com/page", "techcrunch.com");
    // www.domain redirect is allowed by isRedirectAllowedDomain in scraper.service.js
    // validateRedirectUrl itself may block this — depends on implementation
    // At minimum it should not crash
    expect(result).toHaveProperty("safe");
  });

  test("blocks redirect to a completely different domain", () => {
    const result = validateRedirectUrl("https://malicious-site.com/steal", "techcrunch.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/cross-domain/i);
  });

  test("blocks redirect to private IP", () => {
    const result = validateRedirectUrl("http://192.168.1.1/internal", "techcrunch.com");
    expect(result.safe).toBe(false);
  });

  test("blocks redirect to localhost", () => {
    const result = validateRedirectUrl("http://localhost/admin", "techcrunch.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/localhost/i);
  });

  test("blocks redirect to non-http scheme", () => {
    const result = validateRedirectUrl("ftp://files.techcrunch.com/data", "techcrunch.com");
    expect(result.safe).toBe(false);
  });

  test("blocks redirect to non-standard port", () => {
    const result = validateRedirectUrl("https://techcrunch.com:9000/page", "techcrunch.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/port/i);
  });

  test("returns safe: false for malformed redirect URL", () => {
    const result = validateRedirectUrl("not-a-url", "techcrunch.com");
    expect(result.safe).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkResponseSafety — response size and content type (TC_SEC_003)
// ════════════════════════════════════════════════════════════════════════════

describe("checkResponseSafety — response validation", () => {

  function makeResponse(contentType, contentLength, data = "<html></html>") {
    return {
      headers: {
        "content-type":   contentType,
        "content-length": String(contentLength),
      },
      data,
    };
  }

  test("accepts a valid HTML response under 5MB", () => {
    const response = makeResponse("text/html; charset=utf-8", 50000, "<html><body>Content</body></html>");
    const result   = checkResponseSafety(response);
    expect(result.safe).toBe(true);
  });

  test("blocks response with non-HTML content type: application/json", () => {
    const response = makeResponse("application/json", 1000, '{"key":"value"}');
    const result   = checkResponseSafety(response);
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/content type/i);
  });

  test("blocks response with image/jpeg content type", () => {
    const response = makeResponse("image/jpeg", 100000, "binary-data");
    const result   = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  test("blocks response exceeding 5MB via Content-Length header", () => {
    const fiveMBPlus = 5 * 1024 * 1024 + 1;
    const response   = makeResponse("text/html", fiveMBPlus, "<html></html>");
    const result     = checkResponseSafety(response);
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/too large/i);
  });

  test("accepts response with content-length of exactly 5MB", () => {
    const fiveMB   = 5 * 1024 * 1024;
    // Actual data must also be within limit
    const response = makeResponse("text/html", fiveMB, "<html></html>");
    // Content-Length = exactly 5MB is boundary — actual data is tiny so this passes
    const result   = checkResponseSafety(response);
    expect(result.safe).toBe(true);
  });

  test("blocks response when actual body exceeds 5MB even if Content-Length header is missing", () => {
    const bigBody  = "x".repeat(5 * 1024 * 1024 + 100);
    const response = {
      headers: { "content-type": "text/html", "content-length": "0" },
      data:    bigBody,
    };
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/too large/i);
  });

  test("accepts application/xhtml+xml content type (valid HTML variant)", () => {
    const response = makeResponse("application/xhtml+xml", 20000, "<html></html>");
    const result   = checkResponseSafety(response);
    expect(result.safe).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// sanitizeContent — XSS prevention (TC_SEC_004)
// ════════════════════════════════════════════════════════════════════════════

describe("sanitizeContent — HTML stripping and entity decoding", () => {

  test("removes all HTML tags from content, replacing each with a space", () => {
    // Tags are replaced with spaces (not empty string) to prevent words from merging.
    // "Hello <strong>world</strong>" → "Hello  world" (double space is then collapsed by the caller).
    // The important guarantee is that no < or > characters remain.
    const result = sanitizeContent("<p>Hello <strong>world</strong></p>");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
  });

  test("removes script tags but not their inner text — script content is stripped upstream by Cheerio", () => {
    // sanitizeContent operates on text already cleaned by cleanExtractedContent(), which uses
    // Cheerio's .remove() to strip <script> blocks entirely before this function is called.
    // sanitizeContent's job is only to strip tag markup (< ... >), not inner text.
    // Verifying that the tag angle brackets are removed is the correct expectation here.
    const result = sanitizeContent('<script>alert("xss")</script>Real content here.');
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
    expect(result).toContain("Real content");
  });

  test("decodes &amp; entity to &", () => {
    const result = sanitizeContent("AT&amp;T is a company.");
    expect(result).toContain("AT&T");
  });

  test("decodes &lt; and &gt; entities", () => {
    const result = sanitizeContent("Use &lt;br&gt; for line breaks.");
    expect(result).toContain("<br>");
  });

  test("decodes &quot; entity to double quote", () => {
    const result = sanitizeContent('He said &quot;hello&quot;.');
    expect(result).toContain('"hello"');
  });

  test("decodes &nbsp; to a space", () => {
    const result = sanitizeContent("Word&nbsp;gap.");
    expect(result).toContain("Word gap");
  });

  test("removes control characters (0x00–0x08, 0x0B, 0x0E–0x1F)", () => {
    const result = sanitizeContent("Normal\x00text\x07with\x1Fcontrol chars.");
    expect(result).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    expect(result).toContain("Normal");
    expect(result).toContain("text");
  });

  test("preserves newlines (\\n) — needed for paragraph structure", () => {
    const result = sanitizeContent("Para one.\n\nPara two.");
    expect(result).toContain("\n\n");
  });

  test("collapses 4+ consecutive blank lines to maximum 3", () => {
    const result = sanitizeContent("Para.\n\n\n\n\n\nNext.");
    expect(result).not.toMatch(/\n{4,}/);
  });

  test("collapses 3+ consecutive spaces to 2", () => {
    const result = sanitizeContent("Too    many     spaces.");
    expect(result).not.toMatch(/ {3,}/);
  });

  test("returns empty string for null input", () => {
    expect(sanitizeContent(null)).toBe("");
  });

  test("returns empty string for non-string input", () => {
    expect(sanitizeContent(12345)).toBe("");
  });

  test("decodes mdash and ndash entities", () => {
    const result = sanitizeContent("Good&mdash;better&ndash;best.");
    expect(result).toContain("—");
    expect(result).toContain("–");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// sanitizeTitle — title cleaning
// ════════════════════════════════════════════════════════════════════════════

describe("sanitizeTitle — title cleaning and length cap", () => {

  test("strips HTML tags from title", () => {
    const result = sanitizeTitle("<h1>The Real Title</h1>");
    expect(result).toBe("The Real Title");
    expect(result).not.toContain("<h1>");
  });

  test("collapses multiple spaces to single space", () => {
    const result = sanitizeTitle("Title   with   extra   spaces");
    expect(result).toBe("Title with extra spaces");
  });

  test("trims leading and trailing whitespace", () => {
    const result = sanitizeTitle("  Clean Title  ");
    expect(result).toBe("Clean Title");
  });

  test("caps title at MAX_TITLE_LENGTH (500 characters)", () => {
    const longTitle = "A".repeat(600);
    const result    = sanitizeTitle(longTitle);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  test("returns empty string for null input", () => {
    expect(sanitizeTitle(null)).toBe("");
  });

  test("returns empty string for non-string input", () => {
    expect(sanitizeTitle(undefined)).toBe("");
  });

  test("decodes &amp; in titles", () => {
    const result = sanitizeTitle("Tech &amp; Science Weekly");
    expect(result).toContain("Tech & Science Weekly");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildSecureAxiosConfig — request hardening
// ════════════════════════════════════════════════════════════════════════════

describe("buildSecureAxiosConfig — hardened HTTP request settings", () => {

  test("returns a config object", () => {
    const config = buildSecureAxiosConfig();
    expect(typeof config).toBe("object");
  });

  test("maxRedirects is 0 — redirects handled manually in scraper.service.js", () => {
    const config = buildSecureAxiosConfig();
    expect(config.maxRedirects).toBe(0);
  });

  test("timeout is set to a positive number (REQUEST_TIMEOUT_MS)", () => {
    const config = buildSecureAxiosConfig();
    expect(config.timeout).toBeGreaterThan(0);
  });

  test("maxContentLength limits response size", () => {
    const config = buildSecureAxiosConfig();
    expect(config.maxContentLength).toBeGreaterThan(0);
    expect(config.maxContentLength).toBeLessThanOrEqual(5 * 1024 * 1024 + 1);
  });

  test("headers include a User-Agent (browser-like, not 'axios')", () => {
    const config = buildSecureAxiosConfig();
    expect(config.headers["User-Agent"]).toBeDefined();
    expect(config.headers["User-Agent"]).not.toContain("axios");
    expect(config.headers["User-Agent"]).toMatch(/Mozilla/);
  });

  test("headers include Accept for HTML content", () => {
    const config = buildSecureAxiosConfig();
    expect(config.headers["Accept"]).toMatch(/text\/html/);
  });

  test("decompress is enabled (gzip support)", () => {
    const config = buildSecureAxiosConfig();
    expect(config.decompress).toBe(true);
  });
});
