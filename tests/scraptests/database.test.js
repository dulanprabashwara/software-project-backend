// tests/scraptests/database.test.js
// FIX: createScrapingSessionLog now returns session.id (string), not the full object.

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));
const prisma = require("../../src/config/prisma");

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

// ── FIX: extract .id from the created session object ─────────────────────────
async function createScrapingSessionLog(totalSources, lastScrapeDate) {
  const session = await prisma.scrapingSession.create({
    data: { status: "running", lastScrapeDate, totalSources },
  });
  return session.id;  // returns the ID string, not the full object
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
    expect(sessionId).toBe("session-123");      // must be a string
    expect(typeof sessionId).toBe("string");     // not an object
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
