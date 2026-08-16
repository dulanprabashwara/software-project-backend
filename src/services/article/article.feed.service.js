/* src/services/article/article.feed.service.js */

const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");
const {
  ARTICLE_STATUS,
  BASIC_AUTHOR_SELECT,
  ARTICLE_AUTHOR_INCLUDE,
} = require("./article.constants");

/*
 Main article feed (paginated, filtered).
 */
async function getArticleFeed({
  page = 1,
  limit = 10,
  tag,
  authorId,
  search,
  sortBy = "latest",
}) {
  const skip = (page - 1) * limit;

  const where = {
    status: {
      in: [
        ARTICLE_STATUS.PUBLISHED,
        ARTICLE_STATUS.REPUBLISHED,
        ARTICLE_STATUS.EDITING_PUBLISHED,
      ],
    },
  };

  if (tag) {
    where.tags = { has: tag };
  }

  if (authorId) {
    where.authorId = authorId;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { summary: { contains: search, mode: "insensitive" } },
    ];
  }

  const orderBy =
    sortBy === "popular"
      ? [{ shareCount: "desc" }, { readCount: "desc" }, { publishedAt: "desc" }]
      : [{ publishedAt: "desc" }];

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        _count: {
          select: {
            comments: true,
            savedBy: true,
            shares: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.article.count({ where }),
  ]);

  return { articles, total };
}

/*
 List of published articles by user ID.
 */
async function getUserPublishedArticles(userId, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const where = {
    authorId: userId,
    status: {
      in: [
        ARTICLE_STATUS.PUBLISHED,
        ARTICLE_STATUS.REPUBLISHED,
        ARTICLE_STATUS.EDITING_PUBLISHED,
      ],
    },
  };

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
      include: {
        ...ARTICLE_AUTHOR_INCLUDE,
        shares: true,
        liPublishJobs: true,
        wpPublishJobs: true,
        _count: {
          select: {
            comments: true,
            shares: true,
            savedBy: true,
          },
        },
      },
    }),
    prisma.article.count({ where }),
  ]);

  return { articles, total };
}

/*
 List of published articles by username.
 */
async function getPublishedArticlesByUsername(username, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });

  if (!user) {
    throw ApiError.notFound("User not found.");
  }

  const where = {
    authorId: user.id,
    status: {
      in: [
        ARTICLE_STATUS.PUBLISHED,
        ARTICLE_STATUS.REPUBLISHED,
        ARTICLE_STATUS.EDITING_PUBLISHED,
      ],
    },
  };

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
      include: {
        author: {
          select: BASIC_AUTHOR_SELECT,
        },
        _count: {
          select: {
            comments: true,
            shares: true,
            savedBy: true,
          },
        },
      },
    }),
    prisma.article.count({ where }),
  ]);

  return { articles, total };
}

/*
 List of scheduled articles for a user.
 */
async function getUserScheduledArticles(userId, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const where = {
    authorId: userId,
    status: ARTICLE_STATUS.SCHEDULED,
  };

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
      include: {
        author: {
          select: BASIC_AUTHOR_SELECT,
        },
        _count: {
          select: {
            comments: true,
            shares: true,
            savedBy: true,
          },
        },
      },
    }),
    prisma.article.count({ where }),
  ]);

  return { articles, total };
}

/*
 List of drafts for a user.
 */
async function getUserDrafts(userId, page = 1, limit = 10, filters = {}) {
  const skip = (page - 1) * limit;

  const where = {
    authorId: userId,
    status: ARTICLE_STATUS.DRAFT,
  };

  if (typeof filters.isAiGenerated === "boolean") {
    where.isAiGenerated = filters.isAiGenerated;
  }

  const [drafts, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
      include: ARTICLE_AUTHOR_INCLUDE,
    }),
    prisma.article.count({ where }),
  ]);

  return { drafts, total };
}

/*
 Returns top 10 articles by trendingScore. This score is used to drive 
 the AI recommendation slider on the frontend.
 */
async function getTrendingArticles() {
  const articles = await prisma.article.findMany({
    where: {
      status: {
        in: [
          ARTICLE_STATUS.PUBLISHED,
          ARTICLE_STATUS.REPUBLISHED,
          ARTICLE_STATUS.EDITING_PUBLISHED,
        ],
      },
    },
    orderBy: { trendingScore: "desc" },
    take: 10,
    select: {
      id: true,
      title: true,
      summary: true,
      coverImage: true,
      publishedAt: true,
      createdAt: true,
      averageRating: true,
      ratingCount: true,
      commentCount: true,
      readingTime: true,
      author: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
          isPremium: true,
        },
      },
    },
  });
  return articles;
}

module.exports = {
  getArticleFeed,
  getUserPublishedArticles,
  getPublishedArticlesByUsername,
  getUserScheduledArticles,
  getUserDrafts,
  getTrendingArticles,
};


