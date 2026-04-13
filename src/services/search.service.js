// src/services/search.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated search service — completely independent from article.service.js
// and user.service.js so existing functionality is never affected.
//
// Ranking strategy (Medium / Dev.to style):
//   Articles  → title matches first, then summary matches.
//               Within each group: engagement_score DESC
//               engagement_score = (likeCount × 3) + (readCount × 1) + (commentCount × 2)
//   Profiles  → follower_score DESC
//               follower_score = totalFollowers + (articleCount × 10)
// ─────────────────────────────────────────────────────────────────────────────

const prisma = require("../config/prisma");

// ── Weights ──────────────────────────────────────────────────────────────────
const LIKE_W    = 3;
const READ_W    = 1;
const COMMENT_W = 2;

const articleEngagement = (a) =>
  a.likeCount * LIKE_W + a.readCount * READ_W + a.commentCount * COMMENT_W;

// ── Shared Prisma include for article queries ────────────────────────────────
const ARTICLE_INCLUDE = {
  author: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      isPremium: true,
    },
  },
  _count: { select: { comments: true } },
};

// ─────────────────────────────────────────────────────────────────────────────
// searchArticles
// Fetches published articles matching the query, ranked by relevance then
// engagement. Title matches are always surfaced above summary matches.
// ─────────────────────────────────────────────────────────────────────────────
const searchArticles = async ({ query, page = 1, limit = 10 }) => {
  const q = (query || "").trim();
  if (!q) return { articles: [], total: 0, page, limit, totalPages: 0 };

  const baseWhere = { status: "PUBLISHED" };

  // ── Step 1: fetch title matches (up to 50) ──────────────────────────────
  const titleMatches = await prisma.article.findMany({
    where: {
      ...baseWhere,
      title: { contains: q, mode: "insensitive" },
    },
    include: ARTICLE_INCLUDE,
    // Pre-sort by engagement in DB to keep in-memory sort lightweight
    orderBy: [
      { likeCount: "desc" },
      { readCount: "desc" },
      { commentCount: "desc" },
    ],
    take: 50,
  });

  const titleIds = titleMatches.map((a) => a.id);

  // ── Step 2: fetch summary matches that aren't already in title results ──
  const summaryMatches = await prisma.article.findMany({
    where: {
      ...baseWhere,
      // Exclude articles already captured by title match
      ...(titleIds.length > 0 && { NOT: { id: { in: titleIds } } }),
      summary: { contains: q, mode: "insensitive" },
    },
    include: ARTICLE_INCLUDE,
    orderBy: [
      { likeCount: "desc" },
      { readCount: "desc" },
      { commentCount: "desc" },
    ],
    take: 50,
  });

  // ── Step 3: count total for pagination meta ─────────────────────────────
  const total = await prisma.article.count({
    where: {
      ...baseWhere,
      OR: [
        { title:   { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
      ],
    },
  });

  // ── Step 4: sort each group by engagement, merge, paginate ─────────────
  const sortByEngagement = (arr) =>
    [...arr].sort((a, b) => articleEngagement(b) - articleEngagement(a));

  const merged = [
    ...sortByEngagement(titleMatches),
    ...sortByEngagement(summaryMatches),
  ];

  const skip      = (page - 1) * limit;
  const paginated = merged.slice(skip, skip + limit);

  return {
    articles:   paginated,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// searchUsers
// Finds users matching username or displayName, ranked by follower count.
// ─────────────────────────────────────────────────────────────────────────────
const searchUsers = async ({ query, page = 1, limit = 10 }) => {
  const q = (query || "").trim();
  if (!q) return { users: [], total: 0, page, limit, totalPages: 0 };

  const where = {
    OR: [
      { username:    { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
    ],
  };

  const [rawUsers, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id:          true,
        username:    true,
        displayName: true,
        avatarUrl:   true,
        bio:         true,
        isPremium:   true,
        stats: {
          select: {
            totalFollowers: true,
            articleCount:   true,
          },
        },
        _count: {
          select: {
            articles:  { where: { status: "PUBLISHED" } },
            followers: true,
          },
        },
      },
      // Fetch a generous batch then sort in JS for combined scoring
      take: Math.max(limit * 5, 50),
    }),
    prisma.user.count({ where }),
  ]);

  // Sort by follower_score = totalFollowers + articleCount × 10
  const sorted = [...rawUsers].sort((a, b) => {
    const scoreA =
      (a.stats?.totalFollowers ?? a._count?.followers ?? 0) +
      (a.stats?.articleCount   ?? a._count?.articles  ?? 0) * 10;
    const scoreB =
      (b.stats?.totalFollowers ?? b._count?.followers ?? 0) +
      (b.stats?.articleCount   ?? b._count?.articles  ?? 0) * 10;
    return scoreB - scoreA;
  });

  const skip      = (page - 1) * limit;
  const paginated = sorted.slice(skip, skip + limit);

  return {
    users:      paginated,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// getSearchSuggestions
// Returns lightweight autocomplete data: top 5 article titles + top 3 users.
// Called on every debounced keystroke — kept minimal (no content/stats).
// ─────────────────────────────────────────────────────────────────────────────
const getSearchSuggestions = async (query) => {
  const q = (query || "").trim();
  if (q.length < 2) return { articles: [], users: [] };

  const [articles, users] = await Promise.all([
    prisma.article.findMany({
      where: {
        status: "PUBLISHED",
        title:  { contains: q, mode: "insensitive" },
      },
      select: { id: true, title: true, slug: true },
      orderBy: [{ likeCount: "desc" }, { readCount: "desc" }],
      take: 5,
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { username:    { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id:          true,
        username:    true,
        displayName: true,
        avatarUrl:   true,
      },
      take: 3,
    }),
  ]);

  return { articles, users };
};

module.exports = { searchArticles, searchUsers, getSearchSuggestions };
