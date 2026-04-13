// src/services/search.service.js

const prisma = require("../config/prisma");

// ── Engagement weights ────────────────────────────────────────────────────────
const LIKE_W    = 3;
const READ_W    = 1;
const COMMENT_W = 2;

const articleEngagement = (a) =>
  (a.likeCount    || 0) * LIKE_W   +
  (a.readCount    || 0) * READ_W   +
  (a.commentCount || 0) * COMMENT_W;

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

// searchArticles

const searchArticles = async ({ query, page = 1, limit = 10 }) => {
  const q = (query || "").trim();
  if (!q) return { articles: [], total: 0, page, limit, totalPages: 0 };

  try {
    const titleMatches = await prisma.article.findMany({
      where: {
        status: "PUBLISHED",
        title:  { contains: q, mode: "insensitive" },
      },
      include: ARTICLE_INCLUDE,
      orderBy: [{ likeCount: "desc" }, { readCount: "desc" }, { commentCount: "desc" }],
      take: 50,
    });

    const titleIds = titleMatches.map((a) => a.id);

    const summaryMatches = await prisma.article.findMany({
      where: {
        status: "PUBLISHED",
        ...(titleIds.length > 0 && { NOT: { id: { in: titleIds } } }),
        summary: { contains: q, mode: "insensitive" },
      },
      include: ARTICLE_INCLUDE,
      orderBy: [{ likeCount: "desc" }, { readCount: "desc" }, { commentCount: "desc" }],
      take: 50,
    });

    const total = await prisma.article.count({
      where: {
        status: "PUBLISHED",
        OR: [
          { title:   { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
        ],
      },
    });

    const sortByEngagement = (arr) =>
      [...arr].sort((a, b) => articleEngagement(b) - articleEngagement(a));

    const merged    = [...sortByEngagement(titleMatches), ...sortByEngagement(summaryMatches)];
    const skip      = (page - 1) * limit;
    const paginated = merged.slice(skip, skip + limit);

    return { articles: paginated, total, page, limit, totalPages: Math.ceil(total / limit) };
  } catch (err) {
    console.error("[search.service] searchArticles error:", err.message);
    throw err;
  }
};


// searchUsers

const searchUsers = async ({ query, page = 1, limit = 10, currentUserId = null }) => {
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
          stats: {
            select: {
              totalFollowers: true,
              articleCount:   true,
            },
          },
          // Simple _count — NO { where } filter (Prisma 4.x compatible)
          _count: {
            select: {
              articles:  true,
              followers: true,
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

    // ── Bulk isFollowing check ────────────────────────────────────────────────
    // One extra query to find which paginated users the current user follows.
    // This prevents N+1 and means UserCard renders with correct state immediately.
    let followingSet = new Set();

    if (currentUserId && paginated.length > 0) {
      const userIds = paginated.map((u) => u.id);

      // Exclude the current user from the list (can't follow yourself)
      const checkIds = userIds.filter((id) => id !== currentUserId);

      if (checkIds.length > 0) {
        const follows = await prisma.follow.findMany({
          where: {
            followerId:  currentUserId,
            followingId: { in: checkIds },
          },
          select: { followingId: true },
        });

        followingSet = new Set(follows.map((f) => f.followingId));
      }
    }

    // Stamp isFollowing on each user in the result
    const usersWithFollowState = paginated.map((u) => ({
      ...u,
      // Only include isFollowing when we actually checked (logged-in user)
      ...(currentUserId !== null && { isFollowing: followingSet.has(u.id) }),
    }));

    return {
      users:      usersWithFollowState,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

  } catch (err) {
    console.error("[search.service] searchUsers error:", err.message);
    throw err;
  }
};


// getSearchSuggestions 

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
        select:  { id: true, title: true, slug: true },
        orderBy: [{ likeCount: "desc" }, { readCount: "desc" }],
        take:    5,
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { username:    { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, username: true, displayName: true, avatarUrl: true },
        take:   3,
      }),
    ]);

    return { articles, users };
  } catch (err) {
    console.error("[search.service] getSearchSuggestions error:", err.message);
    throw err;
  }
};

module.exports = { searchArticles, searchUsers, getSearchSuggestions };
