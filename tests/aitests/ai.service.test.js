// tests/aitests/ai.service.test.js
// =============================================================================
//  Unit Tests — AI Article Generation System
//
//  Covers  : ai.service.js (all exported functions) + ai.controller.js
//            (input validation and HTTP response codes)
//
//  Mocked  :
//    ../../src/config/prisma   → mocks/prisma.mock.ai.js
//    openai                    → mocks/openai.mock.js
//    uuid                      → mocks/uuid.mock.js
//    ../../src/config/keywords → inline array
//    ../../src/utils/helpers   → inline jest stubs
//
//  Strategy: every dependency is fully mocked. jest.resetAllMocks() runs
//  before each test for complete isolation. No network or DB connections.
// =============================================================================

// ── Hoisted mock declarations ─────────────────────────────────────────────────

jest.mock("../../src/config/prisma",   () => require("../mocks/prisma.mock.ai"));
jest.mock("openai",                    () => require("../mocks/openai.mock"));
jest.mock("uuid",                      () => require("../mocks/uuid.mock"));
jest.mock("../../src/config/keywords", () => [
  "technology", "AI", "health", "finance", "travel",
  "food", "sports", "science", "education", "business",
]);
jest.mock("../../src/utils/helpers", () => ({
  generateUniqueSlug:   jest.fn().mockResolvedValue("test-slug"),
  calculateReadingTime: jest.fn().mockReturnValue(5),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

const prisma             = require("../../src/config/prisma");
const { mockChatCreate } = require("../mocks/openai.mock");
const aiService          = require("../../src/services/ai.service");
const { generateUniqueSlug, calculateReadingTime } = require("../../src/utils/helpers");

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Wraps raw content as a realistic OpenAI completions response */
const aiResp = (content, pTok = 100, cTok = 200) => ({
  choices: [{ message: { content } }],
  usage:   { prompt_tokens: pTok, completion_tokens: cTok },
});

/** AI response for analyzePrompt */
const analyzeResp = ({ topic = "Technology", keywords = ["AI", "technology"], hasLength = false, hasTone = false } = {}) =>
  aiResp(JSON.stringify({ topic, keywords, hasArticleLengthInPrompt: hasLength, hasToneInPrompt: hasTone }));

/** AI response for generate / regenerate */
const genResp = (title = "Test Article", words = 400) =>
  aiResp(JSON.stringify({ title, content: Array(words).fill("word").join(" ") }));

/** Baseline ai_article_logs record */
const makeLog = (o = {}) => ({
  id: "log-001", authorId: "user-001", userPrompt: "Write about AI",
  keywordsPresented: ["AI"], keywordsSelected: ["AI"],
  articleTitle: "AI Today", articleContent: Array(400).fill("word").join(" "),
  wordCount: 400, articleLength: "short", tone: "professional",
  aiInputTokens: 100, aiOutputTokens: 200,
  generatedAt: new Date(), deletedAt: null, linkedArticleId: null,
  userResponse: null, ...o,
});

/** Baseline Article record */
const makeArticle = (o = {}) => ({
  id: "art-001", title: "AI Today", slug: "ai-today",
  content: Array(400).fill("word").join(" "),
  status: "DRAFT", isAiGenerated: true, readingTime: 5,
  authorId: "user-001",
  author: { id: "user-001", username: "tester", displayName: "Tester", avatarUrl: null },
  ...o,
});

// ── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Reset session cache to prevent test interference
  const { sessionCache } = require("../../src/services/ai.service");
  if (sessionCache && sessionCache.clear) {
    sessionCache.clear();
  }
  prisma.scrapedArticle.findMany.mockResolvedValue([]);
  prisma.ai_article_logs.deleteMany.mockResolvedValue({ count: 0 });
  generateUniqueSlug.mockResolvedValue("test-slug");
  calculateReadingTime.mockReturnValue(5);
});

// =============================================================================
//  TC-AP — analyzePrompt
// =============================================================================

describe("analyzePrompt", () => {

  test("TC-AP-01 returns sessionId, topic, and keywords on success", async () => {
    mockChatCreate.mockResolvedValue(analyzeResp({ topic: "Technology", keywords: ["AI", "technology"] }));
    const result = await aiService.analyzePrompt("Write about AI");
    expect(typeof result.sessionId).toBe("string");
    expect(result.topic).toBe("Technology");
    expect(result.keywords).toEqual(["AI", "technology"]);
  });

  test("TC-AP-02 hasArticleLengthInPrompt is true when AI detects length in prompt", async () => {
    mockChatCreate.mockResolvedValue(analyzeResp({ hasLength: true }));
    const result = await aiService.analyzePrompt("Write a 500-word article about AI");
    expect(result.hasArticleLengthInPrompt).toBe(true);
  });

  test("TC-AP-03 hasToneInPrompt is true when AI detects tone in prompt", async () => {
    mockChatCreate.mockResolvedValue(analyzeResp({ hasTone: true }));
    const result = await aiService.analyzePrompt("Write a casual funny article about food");
    expect(result.hasToneInPrompt).toBe(true);
  });

  test("TC-AP-04 strips markdown code fences before parsing JSON", async () => {
    const json = JSON.stringify({ topic: "Health", keywords: ["health"], hasArticleLengthInPrompt: false, hasToneInPrompt: false });
    mockChatCreate.mockResolvedValue(aiResp("```json\n" + json + "\n```"));
    const result = await aiService.analyzePrompt("Write about health");
    expect(result.topic).toBe("Health");
  });

  test("TC-AP-05 caps keywords at 10 when AI returns more than 10", async () => {
    const fifteenKws = Array.from({ length: 15 }, (_, i) => `kw${i}`);
    mockChatCreate.mockResolvedValue(analyzeResp({ keywords: fifteenKws }));
    const result = await aiService.analyzePrompt("broad topic");
    expect(result.keywords.length).toBeLessThanOrEqual(10);
  });

  test("TC-AP-06 stores session so generateArticle can resolve prompt from it", async () => {
    mockChatCreate.mockResolvedValue(analyzeResp({ topic: "Finance" }));
    const { sessionId } = await aiService.analyzePrompt("Write about finance");
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    mockChatCreate.mockResolvedValue(genResp("Finance Article", 400));
    const gen = await aiService.generateArticle({
      sessionId, selectedKeywords: ["finance"],
      articleLength: "short", tone: "professional", authorId: "user-001",
    });
    expect(gen.title).toBe("Finance Article");
  });

  test("TC-AP-07 throws All AI models failed when every model errors", async () => {
    mockChatCreate.mockRejectedValue(new Error("Network timeout"));
    await expect(aiService.analyzePrompt("Write about AI"))
      .rejects.toThrow("All AI models failed");
  });

  test("TC-AP-08 throws when AI returns completely unparseable content", async () => {
    mockChatCreate.mockResolvedValue(aiResp("this is not json @@@###"));
    await expect(aiService.analyzePrompt("any input")).rejects.toThrow();
  });

});

// =============================================================================
//  TC-GA — generateArticle
// =============================================================================

describe("generateArticle", () => {

  test("TC-GA-01 returns title, content, wordCount, and logId on success", async () => {
    mockChatCreate.mockResolvedValue(genResp("My AI Article", 400));
    prisma.ai_article_logs.create.mockResolvedValue(makeLog({ id: "log-gen-001" }));
    const result = await aiService.generateArticle({
      userInput: "Write about machine learning",
      selectedKeywords: ["AI"], articleLength: "short",
      tone: "professional", authorId: "user-001",
    });
    expect(result).toMatchObject({ title: "My AI Article", logId: "log-gen-001" });
    expect(typeof result.content).toBe("string");
    expect(typeof result.wordCount).toBe("number");
  });

  test("TC-GA-02 resolves prompt from valid session when no direct userInput", async () => {
    mockChatCreate.mockResolvedValue(analyzeResp({ topic: "Sports" }));
    const { sessionId } = await aiService.analyzePrompt("Write about cricket");
    prisma.ai_article_logs.create.mockResolvedValue(makeLog({ id: "log-session-001" }));
    mockChatCreate.mockResolvedValue(genResp("Cricket Article", 400));
    const result = await aiService.generateArticle({
      sessionId, selectedKeywords: ["sports"],
      articleLength: "short", tone: "professional", authorId: "user-001",
    });
    expect(result.title).toBe("Cricket Article");
    expect(result.logId).toBe("log-session-001");
  });

  test("TC-GA-03 throws No prompt available when userInput is empty and sessionId invalid", async () => {
    await expect(aiService.generateArticle({
      sessionId: "ghost-session-xyz", userInput: "   ",
      selectedKeywords: [], articleLength: "short", authorId: "user-001",
    })).rejects.toThrow("No prompt available. Please start over.");
  });

  test("TC-GA-04 throws All AI models failed when every model errors", async () => {
    mockChatCreate.mockRejectedValue(new Error("Service down"));
    await expect(aiService.generateArticle({
      userInput: "Write about technology",
      articleLength: "short", tone: "professional", authorId: "user-001",
    })).rejects.toThrow("All AI models failed");
  });

  test("TC-GA-05 makes a second correction call when content word count is too short", async () => {
    const tooShort  = Array(50).fill("word").join(" ");
    const corrected = Array(400).fill("word").join(" ");
    mockChatCreate
      .mockResolvedValueOnce(aiResp(JSON.stringify({ title: "T", content: tooShort })))
      .mockResolvedValueOnce(aiResp(JSON.stringify({ title: "T", content: corrected })));
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    await aiService.generateArticle({
      userInput: "Write about tech", articleLength: "short",
      tone: "professional", authorId: "user-001",
    });
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  test("TC-GA-06 makes a second correction call when content word count is too long", async () => {
    const tooLong   = Array(1200).fill("word").join(" ");
    const corrected = Array(500).fill("word").join(" ");
    mockChatCreate
      .mockResolvedValueOnce(aiResp(JSON.stringify({ title: "T", content: tooLong })))
      .mockResolvedValueOnce(aiResp(JSON.stringify({ title: "T", content: corrected })));
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    await aiService.generateArticle({
      userInput: "Write about tech", articleLength: "short", authorId: "user-001",
    });
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  test("TC-GA-07 does NOT make a second call when content is within range on first attempt", async () => {
    mockChatCreate.mockResolvedValue(genResp("Good Article", 600));
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    await aiService.generateArticle({
      userInput: "Write about tech", articleLength: "short", authorId: "user-001",
    });
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  test("TC-GA-08 returns article with logId null when DB save fails", async () => {
    mockChatCreate.mockResolvedValue(genResp("Resilient Article", 400));
    prisma.ai_article_logs.create.mockRejectedValue(new Error("DB connection lost"));
    const result = await aiService.generateArticle({
      userInput: "Write about resilience", articleLength: "short", authorId: "user-001",
    });
    expect(result.title).toBe("Resilient Article");
    expect(result.logId).toBeNull();
  });

  test("TC-GA-09 persists correct data fields to ai_article_logs on success", async () => {
    mockChatCreate.mockResolvedValue(genResp("Saved Article", 400));
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    await aiService.generateArticle({
      userInput: "Write about science", selectedKeywords: ["science"],
      articleLength: "short", tone: "professional", authorId: "user-001",
    });
    const saved = prisma.ai_article_logs.create.mock.calls[0][0].data;
    expect(saved.authorId).toBe("user-001");
    expect(saved.userPrompt).toBe("Write about science");
    expect(saved.articleTitle).toBe("Saved Article");
    expect(saved.keywordsSelected).toEqual(["science"]);
    expect(typeof saved.wordCount).toBe("number");
  });

  test("TC-GA-10 includes REFERENCE MATERIALS in AI prompt when scraped articles exist", async () => {
    prisma.scrapedArticle.findMany.mockResolvedValue([
      { id: "s1", title: "AI Trends", summary: "AI is evolving rapidly." },
    ]);
    mockChatCreate.mockResolvedValue(genResp("AI Article", 400));
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    await aiService.generateArticle({
      userInput: "Write about AI", selectedKeywords: ["AI"],
      articleLength: "short", authorId: "user-001",
    });
    const userMsg = mockChatCreate.mock.calls[0][0].messages.find(m => m.role === "user");
    expect(userMsg.content).toContain("REFERENCE MATERIALS");
  });

  test("TC-GA-11 accumulates tokens from both initial and correction calls", async () => {
    const r1 = aiResp(JSON.stringify({ title: "T", content: Array(50).fill("w").join(" ") }),  150, 300);
    const r2 = aiResp(JSON.stringify({ title: "T", content: Array(400).fill("w").join(" ") }), 200, 400);
    mockChatCreate.mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    await aiService.generateArticle({
      userInput: "Write about tokens", articleLength: "short", authorId: "user-001",
    });
    const saved = prisma.ai_article_logs.create.mock.calls[0][0].data;
    expect(saved.aiInputTokens).toBe(350);
    expect(saved.aiOutputTokens).toBe(700);
  });

});

// =============================================================================
//  TC-RA — regenerateArticle
// =============================================================================

describe("regenerateArticle", () => {

  test("TC-RA-01 returns title, content, wordCount, and logId on success", async () => {
    mockChatCreate.mockResolvedValue(genResp("Fresh Angle Article", 400));
    prisma.ai_article_logs.create.mockResolvedValue(makeLog({ id: "regen-001" }));
    const result = await aiService.regenerateArticle({
      userInput: "Write about AI again", selectedKeywords: ["AI"],
      articleLength: "short", tone: "professional", authorId: "user-001",
    });
    expect(result).toMatchObject({ title: "Fresh Angle Article", logId: "regen-001" });
  });

  test("TC-RA-02 throws No prompt available when sessionId invalid and no userInput", async () => {
    await expect(aiService.regenerateArticle({
      sessionId: "ghost-session", userInput: "",
      articleLength: "short", authorId: "user-001",
    })).rejects.toThrow("No prompt available. Please start over.");
  });

  test("TC-RA-03 throws All AI models failed when every model errors", async () => {
    mockChatCreate.mockRejectedValue(new Error("All down"));
    await expect(aiService.regenerateArticle({
      userInput: "Write about space", articleLength: "short", authorId: "user-001",
    })).rejects.toThrow("All AI models failed");
  });

  test("TC-RA-04 starts token counting from zero (no accumulated analyze tokens)", async () => {
    mockChatCreate.mockResolvedValue(
      aiResp(JSON.stringify({ title: "T", content: Array(400).fill("w").join(" ") }), 120, 240)
    );
    prisma.ai_article_logs.create.mockResolvedValue(makeLog());
    await aiService.regenerateArticle({
      userInput: "Write about nature", articleLength: "short", authorId: "user-001",
    });
    const saved = prisma.ai_article_logs.create.mock.calls[0][0].data;
    expect(saved.aiInputTokens).toBe(120);
    expect(saved.aiOutputTokens).toBe(240);
  });

  test("TC-RA-05 returns logId null when DB save fails", async () => {
    mockChatCreate.mockResolvedValue(genResp("Regen Graceful", 400));
    prisma.ai_article_logs.create.mockRejectedValue(new Error("DB error"));
    const result = await aiService.regenerateArticle({
      userInput: "Write something", articleLength: "short", authorId: "user-001",
    });
    expect(result.title).toBe("Regen Graceful");
    expect(result.logId).toBeNull();
  });

});

// =============================================================================
//  TC-SD — saveDraft
// =============================================================================

describe("saveDraft", () => {

  test("TC-SD-01 creates a new DRAFT article and links it to the log", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ linkedArticleId: null }));
    prisma.article.create.mockResolvedValue(makeArticle({ id: "new-draft-001" }));
    prisma.ai_article_logs.update.mockResolvedValue({});
    const { draft, alreadySaved } = await aiService.saveDraft({ logId: "log-001", authorId: "user-001" });
    expect(alreadySaved).toBe(false);
    expect(draft.id).toBe("new-draft-001");
    expect(prisma.article.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isAiGenerated: true, status: "DRAFT" }) })
    );
  });

  test("TC-SD-02 links the new article back to the log via update", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ linkedArticleId: null }));
    prisma.article.create.mockResolvedValue(makeArticle({ id: "linked-001" }));
    prisma.ai_article_logs.update.mockResolvedValue({});
    await aiService.saveDraft({ logId: "log-001", authorId: "user-001" });
    expect(prisma.ai_article_logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { linkedArticleId: "linked-001" } })
    );
  });

  test("TC-SD-03 returns alreadySaved true when log already has a linked DRAFT article", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ linkedArticleId: "existing-001" }));
    prisma.article.findUnique.mockResolvedValue(makeArticle({ id: "existing-001", status: "DRAFT" }));
    const { draft, alreadySaved } = await aiService.saveDraft({ logId: "log-001", authorId: "user-001" });
    expect(alreadySaved).toBe(true);
    expect(draft.id).toBe("existing-001");
    expect(prisma.article.create).not.toHaveBeenCalled();
  });

  test("TC-SD-04 transitions EDITING article to DRAFT (alreadySaved false)", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ linkedArticleId: "editing-001" }));
    prisma.article.findUnique.mockResolvedValue(makeArticle({ id: "editing-001", status: "EDITING" }));
    prisma.article.update.mockResolvedValue(makeArticle({ id: "editing-001", status: "DRAFT" }));
    const { draft, alreadySaved } = await aiService.saveDraft({ logId: "log-001", authorId: "user-001" });
    expect(alreadySaved).toBe(false);
    expect(draft.status).toBe("DRAFT");
  });

  test("TC-SD-05 throws when log is not found", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(null);
    await expect(aiService.saveDraft({ logId: "bad-log", authorId: "user-001" }))
      .rejects.toThrow("Article log not found");
  });

  test("TC-SD-06 throws when log belongs to a different author", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ authorId: "other-user" }));
    await expect(aiService.saveDraft({ logId: "log-001", authorId: "user-001" }))
      .rejects.toThrow("You can only save your own articles.");
  });

});

// =============================================================================
//  TC-LE — loadToEditor
// =============================================================================

describe("loadToEditor", () => {

  test("TC-LE-01 creates a new EDITING article when no linked article exists", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ linkedArticleId: null }));
    prisma.article.create.mockResolvedValue(makeArticle({ id: "editor-001", status: "EDITING" }));
    prisma.ai_article_logs.update.mockResolvedValue({});
    const result = await aiService.loadToEditor({ logId: "log-001", authorId: "user-001" });
    expect(result).toEqual({ articleId: "editor-001" });
    expect(prisma.article.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "EDITING" }) })
    );
  });

  test("TC-LE-02 sets existing linked article to EDITING status", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ linkedArticleId: "existing-002" }));
    prisma.article.update.mockResolvedValue(makeArticle({ id: "existing-002", status: "EDITING" }));
    const result = await aiService.loadToEditor({ logId: "log-001", authorId: "user-001" });
    expect(result).toEqual({ articleId: "existing-002" });
    expect(prisma.article.create).not.toHaveBeenCalled();
  });

  test("TC-LE-03 throws when log is not found", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(null);
    await expect(aiService.loadToEditor({ logId: "bad-id", authorId: "user-001" }))
      .rejects.toThrow("Article log not found.");
  });

  test("TC-LE-04 throws when log belongs to a different author", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ authorId: "intruder" }));
    await expect(aiService.loadToEditor({ logId: "log-001", authorId: "user-001" }))
      .rejects.toThrow("You can only edit your own articles.");
  });

});

// =============================================================================
//  TC-DL — softDeleteLog
// =============================================================================

describe("softDeleteLog", () => {

  test("TC-DL-01 sets a deletedAt timestamp on the log", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog());
    prisma.ai_article_logs.update.mockResolvedValue({});
    await aiService.softDeleteLog({ logId: "log-001", authorId: "user-001" });
    expect(prisma.ai_article_logs.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  test("TC-DL-02 throws when log is not found", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(null);
    await expect(aiService.softDeleteLog({ logId: "missing", authorId: "user-001" }))
      .rejects.toThrow("Article not found.");
  });

  test("TC-DL-03 throws when log belongs to a different author", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ authorId: "other-user" }));
    await expect(aiService.softDeleteLog({ logId: "log-001", authorId: "user-001" }))
      .rejects.toThrow("You can only delete your own articles.");
  });

});

// =============================================================================
//  TC-RL — restoreLog
// =============================================================================

describe("restoreLog", () => {

  test("TC-RL-01 clears deletedAt for a log deleted within the 1-hour window", async () => {
    const deletedAt = new Date(Date.now() - 10 * 60 * 1000);
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ deletedAt }));
    prisma.ai_article_logs.update.mockResolvedValue({});
    await aiService.restoreLog({ logId: "log-001", authorId: "user-001" });
    expect(prisma.ai_article_logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: null } })
    );
  });

  test("TC-RL-02 throws Restore window has expired when deleted more than 1 hour ago", async () => {
    const deletedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ deletedAt }));
    await expect(aiService.restoreLog({ logId: "log-001", authorId: "user-001" }))
      .rejects.toThrow("Restore window has expired");
  });

  test("TC-RL-03 throws when article is not currently soft-deleted", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ deletedAt: null }));
    await expect(aiService.restoreLog({ logId: "log-001", authorId: "user-001" }))
      .rejects.toThrow("This article is not deleted.");
  });

  test("TC-RL-04 throws when log is not found", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(null);
    await expect(aiService.restoreLog({ logId: "ghost-id", authorId: "user-001" }))
      .rejects.toThrow("Article not found");
  });

  test("TC-RL-05 throws when log belongs to a different author", async () => {
    const deletedAt = new Date(Date.now() - 5 * 60 * 1000);
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ authorId: "other-user", deletedAt }));
    await expect(aiService.restoreLog({ logId: "log-001", authorId: "user-001" }))
      .rejects.toThrow("You can only restore your own articles.");
  });

});

// =============================================================================
//  TC-GL — getArticleLogs
// =============================================================================

describe("getArticleLogs", () => {

  test("TC-GL-01 runs permanent cleanup deleteMany before fetching logs", async () => {
    prisma.ai_article_logs.findMany.mockResolvedValue([]);
    await aiService.getArticleLogs("user-001");
    expect(prisma.ai_article_logs.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ authorId: "user-001" }) })
    );
  });

  test("TC-GL-02 returns only active logs ordered by generatedAt desc", async () => {
    const logs = [makeLog({ id: "l1" }), makeLog({ id: "l2" })];
    prisma.ai_article_logs.findMany.mockResolvedValue(logs);
    const result = await aiService.getArticleLogs("user-001");
    expect(result).toHaveLength(2);
    expect(prisma.ai_article_logs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   expect.objectContaining({ deletedAt: null, linkedArticleId: null }),
        orderBy: { generatedAt: "desc" },
      })
    );
  });

  test("TC-GL-03 continues fetching even if cleanup deleteMany throws", async () => {
    prisma.ai_article_logs.deleteMany.mockRejectedValue(new Error("Cleanup failed"));
    prisma.ai_article_logs.findMany.mockResolvedValue([makeLog()]);
    const result = await aiService.getArticleLogs("user-001");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

});

// =============================================================================
//  TC-TK — getTrendingKeywords
// =============================================================================

describe("getTrendingKeywords", () => {

  test("TC-TK-01 ranks keywords by frequency descending", async () => {
    prisma.ai_article_logs.findMany.mockResolvedValue([
      { keywordsSelected: ["AI", "technology"] },
      { keywordsSelected: ["AI", "health"] },
      { keywordsSelected: ["technology", "finance"] },
      { keywordsSelected: ["AI"] },
    ]);
    const result = await aiService.getTrendingKeywords();
    const ai   = result.find(k => k.keyword === "AI");
    const tech = result.find(k => k.keyword === "technology");
    expect(ai.usageCount).toBe(3);
    expect(tech.usageCount).toBe(2);
    expect(result.indexOf(ai)).toBeLessThan(result.indexOf(tech));
  });

  test("TC-TK-02 never returns more than 10 keywords", async () => {
    prisma.ai_article_logs.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ keywordsSelected: [`k${i}`, "AI"] }))
    );
    const result = await aiService.getTrendingKeywords();
    expect(result.length).toBeLessThanOrEqual(10);
  });

  test("TC-TK-03 supplements with single-use keywords to reach minimum of 5", async () => {
    prisma.ai_article_logs.findMany.mockResolvedValue([
      { keywordsSelected: ["AI"]      },
      { keywordsSelected: ["health"]  },
      { keywordsSelected: ["finance"] },
      { keywordsSelected: ["travel"]  },
      { keywordsSelected: ["food"]    },
    ]);
    const result = await aiService.getTrendingKeywords();
    expect(result.length).toBeGreaterThanOrEqual(5);
  });

  test("TC-TK-04 each result entry has keyword, usageCount, and mostRecentRank", async () => {
    prisma.ai_article_logs.findMany.mockResolvedValue([
      { keywordsSelected: ["AI", "health"] },
      { keywordsSelected: ["AI"] },
    ]);
    const result = await aiService.getTrendingKeywords();
    result.forEach(entry => {
      expect(entry).toHaveProperty("keyword");
      expect(entry).toHaveProperty("usageCount");
      expect(entry).toHaveProperty("mostRecentRank");
    });
  });

  test("TC-TK-05 returns empty array when no logs exist", async () => {
    prisma.ai_article_logs.findMany.mockResolvedValue([]);
    const result = await aiService.getTrendingKeywords();
    expect(result).toEqual([]);
  });

});

// =============================================================================
//  TC-TA — getTopAIArticles
// =============================================================================

describe("getTopAIArticles", () => {

  test("TC-TA-01 queries PUBLISHED AI articles ordered by trendingScore desc limited to 3", async () => {
    const articles = Array.from({ length: 3 }, (_, i) => ({
      id: `art-${i}`, title: `AI Article ${i}`, author: { displayName: `Author ${i}` },
    }));
    prisma.article.findMany.mockResolvedValue(articles);
    const result = await aiService.getTopAIArticles();
    expect(result).toHaveLength(3);
    expect(prisma.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { isAiGenerated: true, status: "PUBLISHED" },
        orderBy: { trendingScore: "desc" },
        take:    3,
      })
    );
  });

  test("TC-TA-02 returns empty array when no published AI articles exist", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    const result = await aiService.getTopAIArticles();
    expect(result).toEqual([]);
  });

});

// =============================================================================
//  TC-UR — setUserResponse
// =============================================================================

describe("setUserResponse", () => {

  test("TC-UR-01 sets satisfied when log has no existing reaction", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ userResponse: null }));
    prisma.ai_article_logs.update.mockResolvedValue({});
    const result = await aiService.setUserResponse({ logId: "log-001", authorId: "user-001", response: "satisfied" });
    expect(result).toBe("satisfied");
    expect(prisma.ai_article_logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userResponse: "satisfied" } })
    );
  });

  test("TC-UR-02 toggle-off same reaction clicked again clears it and returns null", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ userResponse: "satisfied" }));
    prisma.ai_article_logs.update.mockResolvedValue({});
    const result = await aiService.setUserResponse({ logId: "log-001", authorId: "user-001", response: "satisfied" });
    expect(result).toBeNull();
    expect(prisma.ai_article_logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userResponse: null } })
    );
  });

  test("TC-UR-03 switches from dissatisfied to satisfied", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ userResponse: "dissatisfied" }));
    prisma.ai_article_logs.update.mockResolvedValue({});
    const result = await aiService.setUserResponse({ logId: "log-001", authorId: "user-001", response: "satisfied" });
    expect(result).toBe("satisfied");
  });

  test("TC-UR-04 throws when article log is not found", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(null);
    await expect(aiService.setUserResponse({ logId: "missing", authorId: "user-001", response: "satisfied" }))
      .rejects.toThrow("Article log not found.");
  });

  test("TC-UR-05 throws when log belongs to a different author", async () => {
    prisma.ai_article_logs.findUnique.mockResolvedValue(makeLog({ authorId: "other-user" }));
    await expect(aiService.setUserResponse({ logId: "log-001", authorId: "user-001", response: "satisfied" }))
      .rejects.toThrow("You can only react to your own articles.");
  });

});

// =============================================================================
//  TC-C — Controller input validation and HTTP status codes
// =============================================================================

describe("AI Controller input validation and HTTP response codes", () => {
  let aiController;
  let req, res, next;

  beforeAll(() => {
    aiController = require("../../src/controllers/ai.controller");
  });

  beforeEach(() => {
    req  = { body: {}, params: {}, user: { id: "user-001" } };
    res  = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  const getError = async (fn) => { await fn(req, res, next); return next.mock.calls[0]?.[0]; };

  test("TC-C-01 analyzePrompt calls next with error when userInput is empty string", async () => {
    req.body = { userInput: "" };
    const err = await getError(aiController.analyzePrompt);
    expect(err?.message).toMatch(/userInput is required/i);
  });

  test("TC-C-02 analyzePrompt calls next with error when userInput is whitespace only", async () => {
    req.body = { userInput: "    " };
    const err = await getError(aiController.analyzePrompt);
    expect(err?.message).toMatch(/userInput is required/i);
  });

  test("TC-C-03 generateArticle calls next with error when userInput and sessionId both absent", async () => {
    req.body = {};
    const err = await getError(aiController.generateArticle);
    expect(err).toBeDefined();
  });

  test("TC-C-04 saveDraft calls next with error when logId is missing", async () => {
    req.body = {};
    const err = await getError(aiController.saveDraft);
    expect(err?.message).toMatch(/logId is required/i);
  });

  test("TC-C-05 loadToEditor calls next with error when logId is missing", async () => {
    req.body = {};
    const err = await getError(aiController.loadToEditor);
    expect(err?.message).toMatch(/logId is required/i);
  });

  test("TC-C-06 deleteLog calls next with error when id param is missing", async () => {
    req.params = {};
    const err = await getError(aiController.deleteLog);
    expect(err?.message).toMatch(/Article id is required/i);
  });

  test("TC-C-07 restoreLog calls next with error when id param is missing", async () => {
    req.params = {};
    const err = await getError(aiController.restoreLog);
    expect(err?.message).toMatch(/Article id is required/i);
  });

  test("TC-C-08 setUserResponse calls next with error on invalid response value", async () => {
    req.params = { id: "log-001" };
    req.body   = { response: "extremely_happy" };
    const err  = await getError(aiController.setUserResponse);
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/satisfied.*dissatisfied.*null/i);
  });

  test("TC-C-09 saveDraft responds 201 when a new draft is created", async () => {
    jest.spyOn(aiService, "saveDraft").mockResolvedValue({ draft: makeArticle(), alreadySaved: false });
    req.body = { logId: "log-001" };
    await aiController.saveDraft(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test("TC-C-10 saveDraft responds 200 when article was already saved", async () => {
    jest.spyOn(aiService, "saveDraft").mockResolvedValue({ draft: makeArticle(), alreadySaved: true });
    req.body = { logId: "log-001" };
    await aiController.saveDraft(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ alreadySaved: true }));
  });

  test("TC-C-11 setUserResponse accepts null as valid response and responds 200", async () => {
    jest.spyOn(aiService, "setUserResponse").mockResolvedValue(null);
    req.params = { id: "log-001" };
    req.body   = { response: null };
    await aiController.setUserResponse(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ userResponse: null }));
  });

  test("TC-C-12 loadToEditor responds 200 with articleId on success", async () => {
    jest.spyOn(aiService, "loadToEditor").mockResolvedValue({ articleId: "art-001" });
    req.body = { logId: "log-001" };
    await aiController.loadToEditor(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ articleId: "art-001" }));
  });

});
