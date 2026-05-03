// @ts-nocheck
// @ts-nocheck
const prisma = require("../config/prisma");

// ── CONSTANTS ───────────────────────────────────────────────────────

const DEFAULT_SEARCH_LIMIT           = 10;
const TITLE_MATCH_LIMIT              = 50;
const TAG_MATCH_LIMIT                = 50;
const AUTOCOMPLETE_ARTICLES_LIMIT    = 5;
const AUTOCOMPLETE_USERS_LIMIT       = 3;
const AUTOCOMPLETE_MIN_QUERY_LENGTH  = 2;
const ENGAGEMENT_RATING_MULTIPLIER   = 10;
const ENGAGEMENT_COMMENT_MULTIPLIER  = 2;
const FOLLOWER_ARTICLE_MULTIPLIER    = 10;
const SEARCH_RESULTS_MULTIPLIER      = 5;

// ── HELPERS ─────────────────────────────────────────────────────────

// Escapes special regex characters so user input is safe for RegExp constructor.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Engagement score: quality × volume (rating), depth (comments), reach (reads).
const computeEngagement = (article) =>
  (article.averageRating || 0) * (article.ratingCount || 0) * ENGAGEMENT_RATING_MULTIPLIER +
  (article.readCount     || 0) +
  (article.commentCount  || 0) * ENGAGEMENT_COMMENT_MULTIPLIER;

const sortByEngagement = (articles) =>
  [...articles].sort((a, b) => computeEngagement(b) - computeEngagement(a));

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

// Prisma does not support case-insensitive array-element matching natively,
// so tag queries use $queryRaw with PostgreSQL's unnest + lower().
// Two overloads handle the empty-exclusion-list edge case to avoid passing
// an empty array to ANY(), which some PostgreSQL drivers reject.
const fetchTagMatchIds = (excludeIds, q) =>
  excludeIds.length > 0
    ? prisma.$queryRaw`
        SELECT id FROM articles
        WHERE status = 'PUBLISHED'
        AND id != ALL(${excludeIds})
        AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE lower(t) = lower(${q}))
        LIMIT ${TAG_MATCH_LIMIT}`
    : prisma.$queryRaw`
        SELECT id FROM articles
        WHERE status = 'PUBLISHED'
        AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE lower(t) = lower(${q}))
        LIMIT ${TAG_MATCH_LIMIT}`;

const countTagOnly = (excludeIds, q) =>
  excludeIds.length > 0
    ? prisma.$queryRaw`
        SELECT COUNT(*)::int AS count FROM articles
        WHERE status = 'PUBLISHED'
        AND id != ALL(${excludeIds})
        AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE lower(t) = lower(${q}))`
    : prisma.$queryRaw`
        SELECT COUNT(*)::int AS count FROM articles
        WHERE status = 'PUBLISHED'
        AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE lower(t) = lower(${q}))`;

// ── SEARCH ARTICLES ─────────────────────────────────────────────────

// Three-tier ranking for article search:
//   Tier 1 — title contains the query as an exact whole word (\bquery\b)
//   Tier 2 — any tag exactly equals the query (case-insensitive), not in tier 1
//   Tier 3 — title contains query as a substring/extension (e.g. "princess" for "prince")
// Each tier is independently sorted by engagement score before merging.
// Replaces the previous title + summary approach: summary was causing false
// positives (unrelated content boosting irrelevant articles into top results).
const searchArticles = async ({ query, page = 1, limit = DEFAULT_SEARCH_LIMIT, currentUserId = null }) => {
  const q = (query || "").trim();
  if (!q) return { articles: [], total: 0, page, limit, totalPages: 0 };

  const publishedFilter = { status: "PUBLISHED" };

  // Fetch all title-containing matches first (covers both tier 1 and tier 3).
  const titleMatches = await prisma.article.findMany({
    where: { ...publishedFilter, title: { contains: q, mode: "insensitive" } },
    include: ARTICLE_AUTHOR_SELECT,
    take: TITLE_MATCH_LIMIT,
  });

  const titleIds = titleMatches.map((a) => a.id);

  // Fetch tag-matched articles not already captured by the title query.
  const tagMatchRows = await fetchTagMatchIds(titleIds, q);
  const tagMatchIds  = tagMatchRows.map((r) => r.id);

  const tagMatches = tagMatchIds.length > 0
    ? await prisma.article.findMany({
        where:   { id: { in: tagMatchIds } },
        include: ARTICLE_AUTHOR_SELECT,
      })
    : [];

  // Total = title matches + tag-only matches (no double-counting).
  const [titleTotal, tagOnlyTotalRows] = await Promise.all([
    prisma.article.count({ where: { ...publishedFilter, title: { contains: q, mode: "insensitive" } } }),
    countTagOnly(titleIds, q),
  ]);
  const total = titleTotal + Number(tagOnlyTotalRows[0]?.count ?? 0);

  // Split title matches into tier 1 (exact word) and tier 3 (partial/extension).
  const exactWordRegex  = new RegExp(`\\b${escapeRegex(q)}\\b`, "i");
  const tier1 = titleMatches.filter((a) =>  exactWordRegex.test(a.title));
  const tier3 = titleMatches.filter((a) => !exactWordRegex.test(a.title));

  const merged    = [...sortByEngagement(tier1), ...sortByEngagement(tagMatches), ...sortByEngagement(tier3)];
  const skip      = (page - 1) * limit;
  const paginated = merged.slice(skip, skip + limit);

  // Bulk-check saved state for the logged-in user in a single query.
  let savedSet = new Set();
  if (currentUserId && paginated.length > 0) {
    const saved = await prisma.savedArticle.findMany({
      where:  { userId: currentUserId, articleId: { in: paginated.map((a) => a.id) } },
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

// ── SEARCH USERS ────────────────────────────────────────────────────

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
      where:  nameFilter,
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

  // Bulk-check follow state for the logged-in user in a single query.
  let followingSet = new Set();
  if (currentUserId && paginated.length > 0) {
    const checkIds = paginated.map((u) => u.id).filter((id) => id !== currentUserId);
    if (checkIds.length > 0) {
      const follows = await prisma.follow.findMany({
        where:  { followerId: currentUserId, followingId: { in: checkIds } },
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

// ── AUTOCOMPLETE SUGGESTIONS ────────────────────────────────────────

// Returns lightweight autocomplete data: up to 5 articles and 3 users.
// Articles are sourced from title matches first, then tag matches to fill
// any remaining slots up to the limit. Minimum query length: 2 characters.
const getSearchSuggestions = async (query) => {
  const q = (query || "").trim();
  if (q.length < AUTOCOMPLETE_MIN_QUERY_LENGTH) return { articles: [], users: [] };

  const titleSuggestions = await prisma.article.findMany({
    where:   { status: "PUBLISHED", title: { contains: q, mode: "insensitive" } },
    select:  { id: true, title: true, slug: true },
    orderBy: [{ averageRating: "desc" }, { ratingCount: "desc" }],
    take:    AUTOCOMPLETE_ARTICLES_LIMIT,
  });

  // Fill remaining slots with tag-matched articles not already shown.
  let tagSuggestions = [];
  const remaining = AUTOCOMPLETE_ARTICLES_LIMIT - titleSuggestions.length;
  if (remaining > 0) {
    const titleSuggestionIds = titleSuggestions.map((a) => a.id);
    const tagRows = await fetchTagMatchIds(titleSuggestionIds, q);
    const tagIds  = tagRows.map((r) => r.id).slice(0, remaining);
    if (tagIds.length > 0) {
      tagSuggestions = await prisma.article.findMany({
        where:   { id: { in: tagIds } },
        select:  { id: true, title: true, slug: true },
        orderBy: [{ averageRating: "desc" }, { ratingCount: "desc" }],
      });
    }
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username:    { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
    take:   AUTOCOMPLETE_USERS_LIMIT,
  });

  return { articles: [...titleSuggestions, ...tagSuggestions], users };
};

module.exports = { searchArticles, searchUsers, getSearchSuggestions };
