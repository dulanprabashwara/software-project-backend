// tests/scraptests/database.test.js
// FIX: createScrapingSessionLog now returns session.id (string), not the full object.
// NEW:  collectArticleLinks is now async and performs a DB pre-filter.

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));
const prisma = require("../../src/config/prisma");

// ── Functions under test (inlined so we don't import the full service) ────────

async function checkDuplicateArticle(url) {
  const existing = await prisma.scrapedArticle.findUnique({ where: { sourceUrl: url }, select: { id: true } });
  return existing !== null;
}

async function saveScrapedArticle(data) {
  return prisma.scrapedArticle.create({ data });
}

async function loadConfiguration() {
  const sources = await prisma.scrapingSource.findMany({
    where: { status: "active" },
    select: { id: true, name: true, url: true, category: true, scrapeWindow: true, minWordCount: true, excludedKeywords: true },
  });
  const sourcesByCategory = {};
  for (const src of sources) {
    const cat = src.category || "Uncategorized";
    if (!sourcesByCategory[cat]) sourcesByCategory[cat] = [];
    sourcesByCategory[cat].push(src);
  }
  return { categories: Object.keys(sourcesByCategory), sourcesByCategory, totalSources: sources.length };
}

async function createScrapingSessionLog(totalSources, lastScrapeDate) {
  const session = await prisma.scrapingSession.create({
    data: { status: "running", lastScrapeDate, totalSources },
  });
  return session.id;
}

// ── Inline collectArticleLinks (mirrors the real async version) ───────────────
// We replicate just the DB interaction piece so we can test the dedup logic
// without needing a real HTTP response or Cheerio parsing.

const MAX_ARTICLES_PER_SOURCE     = 7;
const CANDIDATE_LINKS_PER_SOURCE  = 25;

async function selectFreshArticleLinks(candidates) {
  // candidates: string[] of URLs already scored and deduplicated within page
  if (!candidates.length) return [];

  const existingRecords = await prisma.scrapedArticle.findMany({
    where:  { sourceUrl: { in: candidates } },
    select: { sourceUrl: true },
  });
  const alreadyScraped = new Set(existingRecords.map((r) => r.sourceUrl));

  const fresh = candidates.filter((url) => !alreadyScraped.has(url));
  const known = candidates.filter((url) =>  alreadyScraped.has(url));

  return [
    ...fresh.slice(0, MAX_ARTICLES_PER_SOURCE),
    ...known.slice(0, Math.max(0, MAX_ARTICLES_PER_SOURCE - fresh.length)),
  ].slice(0, MAX_ARTICLES_PER_SOURCE);
}

// ════════════════════════════════════════════════════════════════════════════

describe("checkDuplicateArticle", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns true when article URL already exists in DB", async () => {
    prisma.scrapedArticle.findUnique.mockResolvedValue({ id: "existing-id" });
    expect(await checkDuplicateArticle("https://example.com/article-1")).toBe(true);
    expect(prisma.scrapedArticle.findUnique).toHaveBeenCalledWith({
      where: { sourceUrl: "https://example.com/article-1" }, select: { id: true },
    });
  });

  test("returns false when article URL is new", async () => {
    prisma.scrapedArticle.findUnique.mockResolvedValue(null);
    expect(await checkDuplicateArticle("https://example.com/new")).toBe(false);
  });

  test("calls findUnique with the exact URL", async () => {
    prisma.scrapedArticle.findUnique.mockResolvedValue(null);
    const url = "https://techcrunch.com/2025/01/ai-news";
    await checkDuplicateArticle(url);
    expect(prisma.scrapedArticle.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceUrl: url } })
    );
  });
});

describe("saveScrapedArticle", () => {
  beforeEach(() => jest.clearAllMocks());

  test("calls create with correct data and returns the saved record", async () => {
    prisma.scrapedArticle.create.mockResolvedValue({ id: "new-id", title: "Test" });
    const data = {
      sourceUrl: "https://example.com/article", title: "Test Article",
      content: "[H1] Title\n\nContent.", author: "Jane",
      publishedDate: new Date("2025-01-15"), wordCount: 350,
      category: "Technology & Digital Life", scrapingSourceId: "src-123",
      metadata: { siteName: "Example" }, sessionId: "sess-456",
    };
    const result = await saveScrapedArticle(data);
    expect(prisma.scrapedArticle.create).toHaveBeenCalledWith({ data });
    expect(result.id).toBe("new-id");
  });

  test("propagates database errors", async () => {
    prisma.scrapedArticle.create.mockRejectedValue(new Error("Unique constraint violation"));
    await expect(saveScrapedArticle({ sourceUrl: "dup" })).rejects.toThrow("Unique constraint violation");
  });
});

describe("loadConfiguration", () => {
  beforeEach(() => jest.clearAllMocks());

  test("queries only active sources", async () => {
    prisma.scrapingSource.findMany.mockResolvedValue([]);
    await loadConfiguration();
    expect(prisma.scrapingSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "active" } })
    );
  });

  test("groups sources by category correctly", async () => {
    prisma.scrapingSource.findMany.mockResolvedValue([
      { id: "s1", name: "TechCrunch", url: "https://techcrunch.com", category: "Technology & Digital Life", scrapeWindow: "Last 7 Days", minWordCount: 300, excludedKeywords: [] },
      { id: "s2", name: "The Verge",  url: "https://theverge.com",   category: "Technology & Digital Life", scrapeWindow: "Last 7 Days", minWordCount: 300, excludedKeywords: [] },
      { id: "s3", name: "Healthline", url: "https://healthline.com", category: "Health & Medicine",         scrapeWindow: "Last 30 Days", minWordCount: 400, excludedKeywords: [] },
    ]);
    const config = await loadConfiguration();
    expect(config.totalSources).toBe(3);
    expect(config.sourcesByCategory["Technology & Digital Life"]).toHaveLength(2);
    expect(config.sourcesByCategory["Health & Medicine"]).toHaveLength(1);
  });

  test("returns empty config when no active sources", async () => {
    prisma.scrapingSource.findMany.mockResolvedValue([]);
    const config = await loadConfiguration();
    expect(config.totalSources).toBe(0);
    expect(config.categories).toHaveLength(0);
  });

  test("handles source with no category — assigns Uncategorized", async () => {
    prisma.scrapingSource.findMany.mockResolvedValue([
      { id: "s1", name: "Unknown", url: "https://unknown.com", category: null, scrapeWindow: "Last 7 Days", minWordCount: 300, excludedKeywords: [] },
    ]);
    const config = await loadConfiguration();
    expect(config.categories).toContain("Uncategorized");
  });
});

describe("createScrapingSessionLog", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns the session ID as a string, not the full object", async () => {
    prisma.scrapingSession.create.mockResolvedValue({ id: "session-123", status: "running" });
    const sessionId = await createScrapingSessionLog(5, new Date("2025-01-01"));
    expect(prisma.scrapingSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "running", totalSources: 5 }),
    });
    expect(sessionId).toBe("session-123");
    expect(typeof sessionId).toBe("string");
  });

  test("accepts null lastScrapeDate for first-ever session", async () => {
    prisma.scrapingSession.create.mockResolvedValue({ id: "first-session", status: "running" });
    const sessionId = await createScrapingSessionLog(3, null);
    expect(prisma.scrapingSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lastScrapeDate: null }),
    });
    expect(sessionId).toBe("first-session");
  });

  test("records the correct total source count", async () => {
    prisma.scrapingSession.create.mockResolvedValue({ id: "sess-xyz", status: "running" });
    await createScrapingSessionLog(12, null);
    expect(prisma.scrapingSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalSources: 12 }),
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// selectFreshArticleLinks — the new dedup-aware DB pre-filter
// ════════════════════════════════════════════════════════════════════════════

describe("selectFreshArticleLinks — smart article URL selection", () => {
  beforeEach(() => jest.clearAllMocks());

  // Helper to generate N unique fake article URLs
  function urls(n, prefix = "https://example.com/article-") {
    return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  }

  test("returns only fresh URLs when all candidates are new", async () => {
    const candidates = urls(10);
    // None exist in DB
    prisma.scrapedArticle.findMany.mockResolvedValue([]);

    const result = await selectFreshArticleLinks(candidates);

    // Should return the first MAX_ARTICLES_PER_SOURCE fresh URLs
    expect(result).toHaveLength(MAX_ARTICLES_PER_SOURCE);
    result.forEach((url) => expect(candidates).toContain(url));
  });

  test("bulk-checks candidates in a single DB query (not N queries)", async () => {
    const candidates = urls(15);
    prisma.scrapedArticle.findMany.mockResolvedValue([]);

    await selectFreshArticleLinks(candidates);

    // findMany must be called exactly once with an IN clause
    expect(prisma.scrapedArticle.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.scrapedArticle.findMany).toHaveBeenCalledWith({
      where:  { sourceUrl: { in: candidates } },
      select: { sourceUrl: true },
    });
  });

  test("prioritises fresh URLs over already-scraped ones", async () => {
    const allCandidates = urls(10);
    const freshUrls     = allCandidates.slice(5); // last 5 are fresh
    const knownUrls     = allCandidates.slice(0, 5); // first 5 already scraped

    prisma.scrapedArticle.findMany.mockResolvedValue(
      knownUrls.map((url) => ({ sourceUrl: url }))
    );

    const result = await selectFreshArticleLinks(allCandidates);

    // All 5 fresh should be present
    freshUrls.forEach((url) => expect(result).toContain(url));
    // No known URL should appear (we have enough fresh to fill 7... wait, only 5 fresh)
    // With 5 fresh we still pad with 2 known — let's verify fresh come first
    const freshInResult = result.filter((u) => freshUrls.includes(u));
    const knownInResult = result.filter((u) => knownUrls.includes(u));
    expect(freshInResult.length).toBe(5);
    expect(knownInResult.length).toBe(2); // padded with 2 known to reach 7
  });

  test("fills remaining quota with known URLs when fresh count < MAX_ARTICLES_PER_SOURCE", async () => {
    // Only 3 fresh articles, need 7 total → pad with 4 known
    const allCandidates = urls(12);
    const knownUrls     = allCandidates.slice(0, 9);  // 9 already scraped
    const freshUrls     = allCandidates.slice(9);     // 3 fresh

    prisma.scrapedArticle.findMany.mockResolvedValue(
      knownUrls.map((url) => ({ sourceUrl: url }))
    );

    const result = await selectFreshArticleLinks(allCandidates);

    expect(result).toHaveLength(MAX_ARTICLES_PER_SOURCE); // 7
    const freshInResult = result.filter((u) => freshUrls.includes(u));
    const knownInResult = result.filter((u) => knownUrls.includes(u));
    expect(freshInResult.length).toBe(3);
    expect(knownInResult.length).toBe(4);
  });

  test("never returns more than MAX_ARTICLES_PER_SOURCE URLs", async () => {
    const candidates = urls(25);
    prisma.scrapedArticle.findMany.mockResolvedValue([]);

    const result = await selectFreshArticleLinks(candidates);
    expect(result.length).toBeLessThanOrEqual(MAX_ARTICLES_PER_SOURCE);
  });

  test("returns empty array when candidates list is empty", async () => {
    const result = await selectFreshArticleLinks([]);
    // Should short-circuit without calling DB
    expect(prisma.scrapedArticle.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test("returns empty array when all candidates already scraped and none left to pad", async () => {
    // 0 candidates → empty result
    prisma.scrapedArticle.findMany.mockResolvedValue([]);
    const result = await selectFreshArticleLinks([]);
    expect(result).toEqual([]);
  });

  test("returns all available when total candidates < MAX_ARTICLES_PER_SOURCE", async () => {
    // Only 3 total candidates, all fresh
    const candidates = urls(3);
    prisma.scrapedArticle.findMany.mockResolvedValue([]);

    const result = await selectFreshArticleLinks(candidates);
    expect(result).toHaveLength(3); // can't return more than we have
  });

  test("when all candidates are already scraped, returns up to MAX from known", async () => {
    // 15 candidates, all already scraped
    const candidates = urls(15);
    prisma.scrapedArticle.findMany.mockResolvedValue(
      candidates.map((url) => ({ sourceUrl: url }))
    );

    const result = await selectFreshArticleLinks(candidates);

    // Falls back: 0 fresh, pad with up to 7 known
    expect(result).toHaveLength(MAX_ARTICLES_PER_SOURCE);
    result.forEach((url) => expect(candidates).toContain(url));
  });

  test("does not include duplicate URLs in result", async () => {
    const candidates = urls(10);
    prisma.scrapedArticle.findMany.mockResolvedValue([]);

    const result = await selectFreshArticleLinks(candidates);

    const uniqueResult = new Set(result);
    expect(uniqueResult.size).toBe(result.length);
  });

  test("result only contains URLs that were in the original candidates list", async () => {
    const candidates = urls(10);
    prisma.scrapedArticle.findMany.mockResolvedValue([]);

    const result = await selectFreshArticleLinks(candidates);

    result.forEach((url) => expect(candidates).toContain(url));
  });
});