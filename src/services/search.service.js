// @ts-nocheck
const prisma = require("../config/prisma");

// ── CONSTANTS ───────────────────────────────────────────────────────

// Search limits
const DEFAULT_SEARCH_LIMIT = 10;
const TITLE_MATCH_LIMIT = 50;
const SUMMARY_MATCH_LIMIT = 50;
const AUTOCOMPLETE_ARTICLES_LIMIT = 5;
const AUTOCOMPLETE_USERS_LIMIT = 3;
const AUTOCOMPLETE_MIN_QUERY_LENGTH = 2;

// Engagement scoring
const ENGAGEMENT_RATING_MULTIPLIER = 10;
const ENGAGEMENT_COMMENT_MULTIPLIER = 2;
const FOLLOWER_ARTICLE_MULTIPLIER = 10;

// Pagination
const SEARCH_RESULTS_MULTIPLIER = 5;

// Computes an engagement score for ranking article search results.
// Uses averageRating × ratingCount as the primary signal (reflects both
// quality and popularity), supplemented by read count and comment count.
const computeEngagement = (article) =>
  (article.averageRating || 0) * (article.ratingCount || 0) * ENGAGEMENT_RATING_MULTIPLIER +
  (article.readCount     || 0) +
  (article.commentCount  || 0) * ENGAGEMENT_COMMENT_MULTIPLIER;

const ARTICLE_AUTHOR_SELECT = {
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

// Sorts an array of articles by engagement score descending.
const sortByEngagement = (articles) =>
  [...articles].sort((a, b) => computeEngagement(b) - computeEngagement(a));

// Searches published articles by title then summary.
// Title matches are always ranked above summary matches.
// Within each group, results are ordered by engagement score.
// When currentUserId is provided, stamps isSaved on each result.
const searchArticles = async ({ query, page = 1, limit = DEFAULT_SEARCH_LIMIT, currentUserId = null }) => {
  const q = (query || "").trim();
  if (!q) return { articles: [], total: 0, page, limit, totalPages: 0 };

  const publishedFilter = { status: "PUBLISHED" };
  const caseInsensitive = (field) => ({ [field]: { contains: q, mode: "insensitive" } });

  const titleMatches = await prisma.article.findMany({
    where: { ...publishedFilter, ...caseInsensitive("title") },
    include: ARTICLE_AUTHOR_SELECT,
    orderBy: [{ averageRating: "desc" }, { ratingCount: "desc" }, { readCount: "desc" }],
    take: TITLE_MATCH_LIMIT,
  });

  const titleIds = titleMatches.map((a) => a.id);

  const summaryMatches = await prisma.article.findMany({
    where: {
      ...publishedFilter,
      ...(titleIds.length > 0 && { NOT: { id: { in: titleIds } } }),
      ...caseInsensitive("summary"),
    },
    include: ARTICLE_AUTHOR_SELECT,
    orderBy: [{ averageRating: "desc" }, { ratingCount: "desc" }, { readCount: "desc" }],
    take: SUMMARY_MATCH_LIMIT,
  });

  const total = await prisma.article.count({
    where: {
      ...publishedFilter,
      OR: [
        { title:   { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
      ],
    },
  });

  const merged    = [...sortByEngagement(titleMatches), ...sortByEngagement(summaryMatches)];
  const skip      = (page - 1) * limit;
  const paginated = merged.slice(skip, skip + limit);

  // Bulk-check which articles the current user has already saved (one query).
  let savedSet = new Set();
  if (currentUserId && paginated.length > 0) {
    const saved = await prisma.savedArticle.findMany({
      where: { userId: currentUserId, articleId: { in: paginated.map((a) => a.id) } },
      select: { articleId: true },
    });
    savedSet = new Set(saved.map((s) => s.articleId));
  }

  const articles = paginated.map((a) => ({
    ...a,
    ...(currentUserId !== null && { isSaved: savedSet.has(a.id) }),
  }));

  return { articles, total, page, limit, totalPages: Math.ceil(total / limit) };
};

// Searches users by username or displayName.
// Results are ranked by follower_score = totalFollowers + (articleCount × 10).
// When currentUserId is provided, stamps isFollowing on each result.
const searchUsers = async ({ query, page = 1, limit = DEFAULT_SEARCH_LIMIT, currentUserId = null }) => {
  const q = (query || "").trim();
  if (!q) return { users: [], total: 0, page, limit, totalPages: 0 };

  const nameFilter = {
    OR: [
      { username:    { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
    ],
  };

  const [rawUsers, total] = await Promise.all([
    prisma.user.findMany({
      where: nameFilter,
      select: {
        id:          true,
        username:    true,
        displayName: true,
        avatarUrl:   true,
        bio:         true,
        isPremium:   true,
        stats:  { select: { totalFollowers: true, articleCount: true } },
        _count: { select: { articles: true, followers: true } },
      },
      take: Math.max(limit * SEARCH_RESULTS_MULTIPLIER, 50),
    }),
    prisma.user.count({ where: nameFilter }),
  ]);

  const followerScore = (u) =>
    (u.stats?.totalFollowers ?? u._count?.followers ?? 0) +
    (u.stats?.articleCount   ?? u._count?.articles  ?? 0) * FOLLOWER_ARTICLE_MULTIPLIER;

  const sorted    = [...rawUsers].sort((a, b) => followerScore(b) - followerScore(a));
  const skip      = (page - 1) * limit;
  const paginated = sorted.slice(skip, skip + limit);

  // Bulk-check which users the current user already follows (one query).
  let followingSet = new Set();
  if (currentUserId && paginated.length > 0) {
    const checkIds = paginated.map((u) => u.id).filter((id) => id !== currentUserId);
    if (checkIds.length > 0) {
      const follows = await prisma.follow.findMany({
        where: { followerId: currentUserId, followingId: { in: checkIds } },
        select: { followingId: true },
      });
      followingSet = new Set(follows.map((f) => f.followingId));
    }
  }

  const users = paginated.map((u) => ({
    ...u,
    ...(currentUserId !== null && { isFollowing: followingSet.has(u.id) }),
  }));

  return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
};

// Returns lightweight autocomplete data for a partial query.
// Returns up to 5 article titles and 3 user names. Minimum query length: 2.
const getSearchSuggestions = async (query) => {
  const q = (query || "").trim();
  if (q.length < AUTOCOMPLETE_MIN_QUERY_LENGTH) return { articles: [], users: [] };

  const [articles, users] = await Promise.all([
    prisma.article.findMany({
      where: { status: "PUBLISHED", title: { contains: q, mode: "insensitive" } },
      select:  { id: true, title: true, slug: true },
      orderBy: [{ averageRating: "desc" }, { ratingCount: "desc" }],
      take: AUTOCOMPLETE_ARTICLES_LIMIT,
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { username:    { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
      take: AUTOCOMPLETE_USERS_LIMIT,
    }),
  ]);

  return { articles, users };
};

module.exports = { searchArticles, searchUsers, getSearchSuggestions };
