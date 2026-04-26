// tests/search/search.service.test.js
// Unit tests for src/services/search.service.js
// Database calls are fully mocked via prisma.mock.search.js

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock.search"));

const prisma        = require("../../src/config/prisma");
const searchService = require("../../src/services/search.service");

// ─── Shared fixtures ────────────────────────────────────────────────────────

const makeArticle = (overrides = {}) => ({
  id:            "art-1",
  title:         "Test Article",
  summary:       "A test summary",
  status:        "PUBLISHED",
  averageRating: 4.5,
  ratingCount:   10,
  readCount:     100,
  commentCount:  5,
  coverImage:    null,
  publishedAt:   new Date("2024-01-01"),
  author: {
    id:          "user-1",
    username:    "testuser",
    displayName: "Test User",
    avatarUrl:   null,
    isPremium:   false,
  },
  _count: { comments: 5 },
  ...overrides,
});

const makeUser = (overrides = {}) => ({
  id:          "user-1",
  username:    "testuser",
  displayName: "Test User",
  avatarUrl:   null,
  bio:         "Bio text",
  isPremium:   false,
  stats:       { totalFollowers: 50, articleCount: 5 },
  _count:      { articles: 5, followers: 50 },
  ...overrides,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

beforeEach(() => prisma.__resetAll());

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-001 to TC-SS-005  searchArticles — empty / boundary queries
// ════════════════════════════════════════════════════════════════════════════

describe("searchArticles — empty / boundary queries", () => {

  // TC-SS-001
  test("TC-SS-001: returns empty result when query is an empty string", async () => {
    const result = await searchService.searchArticles({ query: "" });
    expect(result).toEqual({ articles: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  // TC-SS-002
  test("TC-SS-002: returns empty result when query is only whitespace", async () => {
    const result = await searchService.searchArticles({ query: "   " });
    expect(result).toEqual({ articles: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  // TC-SS-003
  test("TC-SS-003: returns empty result when query is null/undefined", async () => {
    const result = await searchService.searchArticles({ query: null });
    expect(result).toEqual({ articles: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  // TC-SS-004
  test("TC-SS-004: calls prisma when a valid query is provided", async () => {
    const article = makeArticle();
    prisma.article.findMany.mockResolvedValue([article]);
    prisma.article.count.mockResolvedValue(1);

    await searchService.searchArticles({ query: "test" });
    expect(prisma.article.findMany).toHaveBeenCalled();
  });

  // TC-SS-005
  test("TC-SS-005: query is trimmed before hitting the database", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.article.count.mockResolvedValue(0);

    await searchService.searchArticles({ query: "  hello  " });
    const callArg = prisma.article.findMany.mock.calls[0][0];
    expect(callArg.where.title.contains).toBe("hello");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-006 to TC-SS-010  searchArticles — ranking & deduplication
// ════════════════════════════════════════════════════════════════════════════

describe("searchArticles — ranking and deduplication", () => {

  // TC-SS-006
  test("TC-SS-006: title-match articles appear before summary-match articles", async () => {
    const titleArt   = makeArticle({ id: "title-1", title: "JavaScript Guide" });
    const summaryArt = makeArticle({ id: "sum-1",   title: "Unrelated Title",
                                     summary: "Covers JavaScript basics" });

    prisma.article.findMany
      .mockResolvedValueOnce([titleArt])   // title matches
      .mockResolvedValueOnce([summaryArt]); // summary matches
    prisma.article.count.mockResolvedValue(2);

    const { articles } = await searchService.searchArticles({ query: "JavaScript" });
    expect(articles[0].id).toBe("title-1");
    expect(articles[1].id).toBe("sum-1");
  });

  // TC-SS-007
  test("TC-SS-007: title-match IDs are excluded from the summary query (no duplicates)", async () => {
    const art = makeArticle({ id: "art-dup" });
    prisma.article.findMany.mockResolvedValueOnce([art]).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(1);

    await searchService.searchArticles({ query: "dup" });

    const summaryCall = prisma.article.findMany.mock.calls[1][0];
    expect(summaryCall.where).toHaveProperty("NOT");
    expect(summaryCall.where.NOT.id.in).toContain("art-dup");
  });

  // TC-SS-008
  test("TC-SS-008: higher-engagement article ranks above lower-engagement article", async () => {
    const highEng = makeArticle({ id: "high", averageRating: 5, ratingCount: 20, readCount: 500 });
    const lowEng  = makeArticle({ id: "low",  averageRating: 1, ratingCount: 1,  readCount: 10  });

    prisma.article.findMany.mockResolvedValueOnce([lowEng, highEng]).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(2);

    const { articles } = await searchService.searchArticles({ query: "test" });
    expect(articles[0].id).toBe("high");
    expect(articles[1].id).toBe("low");
  });

  // TC-SS-009
  test("TC-SS-009: only PUBLISHED articles are queried (status filter applied)", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.article.count.mockResolvedValue(0);

    await searchService.searchArticles({ query: "anything" });

    const titleQuery = prisma.article.findMany.mock.calls[0][0];
    expect(titleQuery.where.status).toBe("PUBLISHED");
  });

  // TC-SS-010
  test("TC-SS-010: search is case-insensitive (mode: insensitive passed to prisma)", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.article.count.mockResolvedValue(0);

    await searchService.searchArticles({ query: "React" });

    const titleQuery = prisma.article.findMany.mock.calls[0][0];
    expect(titleQuery.where.title.mode).toBe("insensitive");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-011 to TC-SS-015  searchArticles — pagination
// ════════════════════════════════════════════════════════════════════════════

describe("searchArticles — pagination", () => {

  const makeArticles = (n) =>
    Array.from({ length: n }, (_, i) =>
      makeArticle({ id: `art-${i}`, averageRating: n - i, ratingCount: 1 })
    );

  // TC-SS-011
  test("TC-SS-011: returns correct page slice (page 2, limit 5)", async () => {
    const arts = makeArticles(12);
    prisma.article.findMany.mockResolvedValueOnce(arts).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(12);

    const { articles, page, limit, totalPages } =
      await searchService.searchArticles({ query: "x", page: 2, limit: 5 });

    expect(page).toBe(2);
    expect(limit).toBe(5);
    expect(articles).toHaveLength(5);
    expect(totalPages).toBe(3);
  });

  // TC-SS-012
  test("TC-SS-012: totalPages is 0 when total is 0", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.article.count.mockResolvedValue(0);

    const { totalPages } = await searchService.searchArticles({ query: "nothing" });
    expect(totalPages).toBe(0);
  });

  // TC-SS-013
  test("TC-SS-013: page 1 is used as default when not supplied", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.article.count.mockResolvedValue(0);

    const { page } = await searchService.searchArticles({ query: "x" });
    expect(page).toBe(1);
  });

  // TC-SS-014
  test("TC-SS-014: limit 10 is used as default when not supplied", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.article.count.mockResolvedValue(0);

    const { limit } = await searchService.searchArticles({ query: "x" });
    expect(limit).toBe(10);
  });

  // TC-SS-015
  test("TC-SS-015: last page returns remaining articles (not a full page)", async () => {
    const arts = makeArticles(11);
    prisma.article.findMany.mockResolvedValueOnce(arts).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(11);

    const { articles } = await searchService.searchArticles({ query: "x", page: 2, limit: 10 });
    expect(articles).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-016 to TC-SS-020  searchArticles — isSaved personalisation
// ════════════════════════════════════════════════════════════════════════════

describe("searchArticles — isSaved personalisation", () => {

  // TC-SS-016
  test("TC-SS-016: isSaved is true for articles the user has saved", async () => {
    const art = makeArticle({ id: "art-saved" });
    prisma.article.findMany.mockResolvedValueOnce([art]).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(1);
    prisma.savedArticle.findMany.mockResolvedValue([{ articleId: "art-saved" }]);

    const { articles } = await searchService.searchArticles({
      query: "test", currentUserId: "user-1",
    });
    expect(articles[0].isSaved).toBe(true);
  });

  // TC-SS-017
  test("TC-SS-017: isSaved is false for articles the user has NOT saved", async () => {
    const art = makeArticle({ id: "art-unsaved" });
    prisma.article.findMany.mockResolvedValueOnce([art]).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(1);
    prisma.savedArticle.findMany.mockResolvedValue([]);

    const { articles } = await searchService.searchArticles({
      query: "test", currentUserId: "user-1",
    });
    expect(articles[0].isSaved).toBe(false);
  });

  // TC-SS-018
  test("TC-SS-018: isSaved is NOT present when currentUserId is null (anonymous)", async () => {
    const art = makeArticle();
    prisma.article.findMany.mockResolvedValueOnce([art]).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(1);

    const { articles } = await searchService.searchArticles({
      query: "test", currentUserId: null,
    });
    expect(articles[0]).not.toHaveProperty("isSaved");
  });

  // TC-SS-019
  test("TC-SS-019: savedArticle query uses a bulk IN clause (single DB round-trip)", async () => {
    const arts = [makeArticle({ id: "a1" }), makeArticle({ id: "a2" })];
    prisma.article.findMany.mockResolvedValueOnce(arts).mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(2);
    prisma.savedArticle.findMany.mockResolvedValue([]);

    await searchService.searchArticles({ query: "test", currentUserId: "u-1" });

    expect(prisma.savedArticle.findMany).toHaveBeenCalledTimes(1);
    const savedQuery = prisma.savedArticle.findMany.mock.calls[0][0];
    expect(savedQuery.where.articleId.in).toEqual(["a1", "a2"]);
  });

  // TC-SS-020
  test("TC-SS-020: savedArticle query is skipped when result page is empty", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.article.count.mockResolvedValue(0);

    await searchService.searchArticles({ query: "ghost", currentUserId: "u-1" });
    expect(prisma.savedArticle.findMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-021 to TC-SS-025  searchUsers — empty / boundary queries
// ════════════════════════════════════════════════════════════════════════════

describe("searchUsers — empty / boundary queries", () => {

  // TC-SS-021
  test("TC-SS-021: returns empty result when query is an empty string", async () => {
    const result = await searchService.searchUsers({ query: "" });
    expect(result).toEqual({ users: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  // TC-SS-022
  test("TC-SS-022: returns empty result when query is only whitespace", async () => {
    const result = await searchService.searchUsers({ query: "   " });
    expect(result).toEqual({ users: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  // TC-SS-023
  test("TC-SS-023: searches both username and displayName (OR filter)", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await searchService.searchUsers({ query: "alice" });

    const call = prisma.user.findMany.mock.calls[0][0];
    const orFields = call.where.OR.map((c) => Object.keys(c)[0]);
    expect(orFields).toContain("username");
    expect(orFields).toContain("displayName");
  });

  // TC-SS-024
  test("TC-SS-024: user search is case-insensitive", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await searchService.searchUsers({ query: "Alice" });

    const call = prisma.user.findMany.mock.calls[0][0];
    expect(call.where.OR[0].username.mode).toBe("insensitive");
  });

  // TC-SS-025
  test("TC-SS-025: total and totalPages reflect DB count", async () => {
    prisma.user.findMany.mockResolvedValue([makeUser()]);
    prisma.user.count.mockResolvedValue(25);

    const { total, totalPages } = await searchService.searchUsers({ query: "a", limit: 10 });
    expect(total).toBe(25);
    expect(totalPages).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-026 to TC-SS-030  searchUsers — ranking & follower score
// ════════════════════════════════════════════════════════════════════════════

describe("searchUsers — ranking by follower score", () => {

  // TC-SS-026
  test("TC-SS-026: user with higher follower count ranks first", async () => {
    const popular = makeUser({ id: "pop", stats: { totalFollowers: 1000, articleCount: 0 } });
    const obscure = makeUser({ id: "obs", stats: { totalFollowers: 1,    articleCount: 0 } });

    prisma.user.findMany.mockResolvedValue([obscure, popular]);
    prisma.user.count.mockResolvedValue(2);

    const { users } = await searchService.searchUsers({ query: "test" });
    expect(users[0].id).toBe("pop");
    expect(users[1].id).toBe("obs");
  });

  // TC-SS-027
  test("TC-SS-027: article count (×10) boosts follower score", async () => {
    // 0 followers + 5 articles = score 50
    const prolific = makeUser({ id: "pro", stats: { totalFollowers: 0, articleCount: 5 } });
    // 40 followers + 0 articles = score 40
    const followed = makeUser({ id: "fol", stats: { totalFollowers: 40, articleCount: 0 } });

    prisma.user.findMany.mockResolvedValue([followed, prolific]);
    prisma.user.count.mockResolvedValue(2);

    const { users } = await searchService.searchUsers({ query: "test" });
    expect(users[0].id).toBe("pro");
  });

  // TC-SS-028
  test("TC-SS-028: falls back to _count when stats is null", async () => {
    const u = makeUser({ id: "u1", stats: null, _count: { followers: 20, articles: 2 } });
    prisma.user.findMany.mockResolvedValue([u]);
    prisma.user.count.mockResolvedValue(1);

    const { users } = await searchService.searchUsers({ query: "test" });
    expect(users[0].id).toBe("u1");
  });

  // TC-SS-029
  test("TC-SS-029: user pagination returns correct page slice", async () => {
    const rawUsers = Array.from({ length: 15 }, (_, i) =>
      makeUser({ id: `u-${i}`, stats: { totalFollowers: 15 - i, articleCount: 0 } })
    );
    prisma.user.findMany.mockResolvedValue(rawUsers);
    prisma.user.count.mockResolvedValue(15);

    const { users, page, limit } =
      await searchService.searchUsers({ query: "t", page: 2, limit: 5 });

    expect(page).toBe(2);
    expect(limit).toBe(5);
    expect(users).toHaveLength(5);
  });

  // TC-SS-030
  test("TC-SS-030: fetch size is at least 50 even when limit is small", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await searchService.searchUsers({ query: "x", limit: 5 });

    const takePassed = prisma.user.findMany.mock.calls[0][0].take;
    expect(takePassed).toBeGreaterThanOrEqual(50);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-031 to TC-SS-035  searchUsers — isFollowing personalisation
// ════════════════════════════════════════════════════════════════════════════

describe("searchUsers — isFollowing personalisation", () => {

  // TC-SS-031
  test("TC-SS-031: isFollowing is true for users the current user follows", async () => {
    const u = makeUser({ id: "target" });
    prisma.user.findMany.mockResolvedValue([u]);
    prisma.user.count.mockResolvedValue(1);
    prisma.follow.findMany.mockResolvedValue([{ followingId: "target" }]);

    const { users } = await searchService.searchUsers({
      query: "test", currentUserId: "me",
    });
    expect(users[0].isFollowing).toBe(true);
  });

  // TC-SS-032
  test("TC-SS-032: isFollowing is false for users not followed", async () => {
    const u = makeUser({ id: "stranger" });
    prisma.user.findMany.mockResolvedValue([u]);
    prisma.user.count.mockResolvedValue(1);
    prisma.follow.findMany.mockResolvedValue([]);

    const { users } = await searchService.searchUsers({
      query: "test", currentUserId: "me",
    });
    expect(users[0].isFollowing).toBe(false);
  });

  // TC-SS-033
  test("TC-SS-033: isFollowing is NOT present for anonymous users", async () => {
    const u = makeUser();
    prisma.user.findMany.mockResolvedValue([u]);
    prisma.user.count.mockResolvedValue(1);

    const { users } = await searchService.searchUsers({
      query: "test", currentUserId: null,
    });
    expect(users[0]).not.toHaveProperty("isFollowing");
  });

  // TC-SS-034
  test("TC-SS-034: current user is excluded from the follow-check IN clause", async () => {
    const self  = makeUser({ id: "me" });
    const other = makeUser({ id: "other" });
    prisma.user.findMany.mockResolvedValue([self, other]);
    prisma.user.count.mockResolvedValue(2);
    prisma.follow.findMany.mockResolvedValue([]);

    await searchService.searchUsers({ query: "test", currentUserId: "me" });

    const followCall = prisma.follow.findMany.mock.calls[0][0];
    expect(followCall.where.followingId.in).not.toContain("me");
    expect(followCall.where.followingId.in).toContain("other");
  });

  // TC-SS-035
  test("TC-SS-035: follow query uses a bulk IN clause (single DB round-trip)", async () => {
    const users = [makeUser({ id: "u1" }), makeUser({ id: "u2" }), makeUser({ id: "u3" })];
    prisma.user.findMany.mockResolvedValue(users);
    prisma.user.count.mockResolvedValue(3);
    prisma.follow.findMany.mockResolvedValue([]);

    await searchService.searchUsers({ query: "test", currentUserId: "me" });
    expect(prisma.follow.findMany).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SS-036 to TC-SS-040  getSearchSuggestions
// ════════════════════════════════════════════════════════════════════════════

describe("getSearchSuggestions", () => {

  // TC-SS-036
  test("TC-SS-036: returns empty arrays when query is shorter than 2 chars", async () => {
    const result = await searchService.getSearchSuggestions("a");
    expect(result).toEqual({ articles: [], users: [] });
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  // TC-SS-037
  test("TC-SS-037: returns empty arrays for empty string", async () => {
    const result = await searchService.getSearchSuggestions("");
    expect(result).toEqual({ articles: [], users: [] });
  });

  // TC-SS-038
  test("TC-SS-038: returns up to 5 articles and 3 users for a valid query", async () => {
    const articles = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`, title: `Art ${i}`, slug: `art-${i}`,
    }));
    const users = Array.from({ length: 3 }, (_, i) => ({
      id: `u${i}`, username: `user${i}`, displayName: `User ${i}`, avatarUrl: null,
    }));

    prisma.article.findMany.mockResolvedValue(articles);
    prisma.user.findMany.mockResolvedValue(users);

    const result = await searchService.getSearchSuggestions("te");
    expect(result.articles).toHaveLength(5);
    expect(result.users).toHaveLength(3);
  });

  // TC-SS-039
  test("TC-SS-039: article suggestions are limited to PUBLISHED status", async () => {
    prisma.article.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    await searchService.getSearchSuggestions("react");

    const articleQuery = prisma.article.findMany.mock.calls[0][0];
    expect(articleQuery.where.status).toBe("PUBLISHED");
  });

  // TC-SS-040
  test("TC-SS-040: both DB queries run in parallel (Promise.all)", async () => {
    let resolveArticles, resolveUsers;
    const callOrder = [];

    prisma.article.findMany.mockImplementation(() => {
      callOrder.push("articles");
      return new Promise((r) => { resolveArticles = r; });
    });
    prisma.user.findMany.mockImplementation(() => {
      callOrder.push("users");
      return new Promise((r) => { resolveUsers = r; });
    });

    const promise = searchService.getSearchSuggestions("te");

    // Both must have been called before either resolves
    expect(callOrder).toContain("articles");
    expect(callOrder).toContain("users");

    resolveArticles([]);
    resolveUsers([]);
    await promise;
  });
});
