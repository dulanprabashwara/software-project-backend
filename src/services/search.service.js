// src/services/search.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated search service — completely independent of article.service.js and
// user.service.js so no existing functionality is affected.
//
// RANKING STRATEGY (Medium / Dev.to style)
// ──────────────────────────────────────────
//   Articles  →  title matches first, then summary matches.
//                Within each group: engagement_score DESC
//                engagement_score = (likeCount × 3) + (readCount × 1) + (commentCount × 2)
//
//   Users     →  follower_score DESC
//                follower_score = totalFollowers + (articleCount × 10)
// ─────────────────────────────────────────────────────────────────────────────

const prisma = require("../config/prisma");

// ── Engagement weights ────────────────────────────────────────────────────────
const LIKE_W    = 3;
const READ_W    = 1;
const COMMENT_W = 2;

const articleEngagement = (a) =>
  (a.likeCount    || 0) * LIKE_W   +
  (a.readCount    || 0) * READ_W   +
  (a.commentCount || 0) * COMMENT_W;

// ── Article include shape ─────────────────────────────────────────────────────
const ARTICLE_INCLUDE = {
  author: {
    select: {
      id:          true,
      username:    true,
      displayName: true,
      avatarUrl:   true,
      isPremium:   true,
    },
  },
  _count: { select: { comments: true } },
};

// ─────────────────────────────────────────────────────────────────────────────
// searchArticles
// Returns PUBLISHED articles matching the query, ranked by:
//   1. Title matches before summary matches
//   2. Engagement score within each group
// ─────────────────────────────────────────────────────────────────────────────
const searchArticles = async ({ query, page = 1, limit = 10 }) => {
  const q = (query || "").trim();
  if (!q) return { articles: [], total: 0, page, limit, totalPages: 0 };

  const baseWhere = { status: "PUBLISHED" };

  try {
    // Step 1 — fetch title matches (up to 50, pre-sorted by DB for speed)
    const titleMatches = await prisma.article.findMany({
      where: {
        ...baseWhere,
        title: { contains: q, mode: "insensitive" },
      },
      include: ARTICLE_INCLUDE,
      orderBy: [
        { likeCount:    "desc" },
        { readCount:    "desc" },
        { commentCount: "desc" },
      ],
      take: 50,
    });

    const titleIds = titleMatches.map((a) => a.id);

    // Step 2 — fetch summary matches NOT already captured by title search
    const summaryMatches = await prisma.article.findMany({
      where: {
        ...baseWhere,
        ...(titleIds.length > 0 && { NOT: { id: { in: titleIds } } }),
        summary: { contains: q, mode: "insensitive" },
      },
      include: ARTICLE_INCLUDE,
      orderBy: [
        { likeCount:    "desc" },
        { readCount:    "desc" },
        { commentCount: "desc" },
      ],
      take: 50,
    });

    // Step 3 — total count for pagination meta
    const total = await prisma.article.count({
      where: {
        ...baseWhere,
        OR: [
          { title:   { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
        ],
      },
    });

    // Step 4 — sort each group by engagement, merge, paginate
    const sortByEngagement = (arr) =>
      [...arr].sort((a, b) => articleEngagement(b) - articleEngagement(a));

    const merged   = [...sortByEngagement(titleMatches), ...sortByEngagement(summaryMatches)];
    const skip     = (page - 1) * limit;
    const paginated = merged.slice(skip, skip + limit);

    return { articles: paginated, total, page, limit, totalPages: Math.ceil(total / limit) };

  } catch (err) {
    // Surface Prisma errors clearly so they are visible in the backend terminal
    console.error("[search.service] searchArticles error:", err.message || err);
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// searchUsers
// Finds users matching username or displayName, ranked by follower score.
//
// NOTE: _count.select does NOT use a { where } filter here to avoid requiring
// the `filteredRelationCount` Prisma preview feature.
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

  try {
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
          // stats relation gives us pre-aggregated counts kept up-to-date
          // by the follow.service.js and article.service.js upserts
          stats: {
            select: {
              totalFollowers: true,
              articleCount:   true,
            },
          },
          // Simple _count — NO { where } filter to stay Prisma 4.x compatible
          _count: {
            select: {
              articles:  true,   // total articles (all statuses)
              followers: true,   // total followers
            },
          },
        },
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

    return { users: paginated, total, page, limit, totalPages: Math.ceil(total / limit) };

  } catch (err) {
    console.error("[search.service] searchUsers error:", err.message || err);
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getSearchSuggestions
// Lightweight autocomplete: top 5 article titles + top 3 users.
// Called on every debounced keystroke — kept minimal for speed.
// ─────────────────────────────────────────────────────────────────────────────
const getSearchSuggestions = async (query) => {
  const q = (query || "").trim();
  if (q.length < 2) return { articles: [], users: [] };

  try {
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

  } catch (err) {
    console.error("[search.service] getSearchSuggestions error:", err.message || err);
    throw err;
  }
};

module.exports = { searchArticles, searchUsers, getSearchSuggestions };
