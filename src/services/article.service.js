/* software-project-backend/src/services/article.service.js */

const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const {
  generateUniqueSlug,
  calculateReadingTime,
} = require("../utils/helpers");

const ARTICLE_STATUS = Object.freeze({
  EDITING: "EDITING",
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  SCHEDULED: "SCHEDULED",
});

function normalizeArticleStatus(status) {
  if (!status) return ARTICLE_STATUS.EDITING;

  const normalized = String(status).trim().toUpperCase();

  switch (normalized) {
    case ARTICLE_STATUS.EDITING:
      return ARTICLE_STATUS.EDITING;
    case ARTICLE_STATUS.DRAFT:
      return ARTICLE_STATUS.DRAFT;
    case ARTICLE_STATUS.PUBLISHED:
      return ARTICLE_STATUS.PUBLISHED;
    case ARTICLE_STATUS.SCHEDULED:
      return ARTICLE_STATUS.SCHEDULED;
    default:
      throw ApiError.badRequest(`Invalid article status: ${status}`);
  }
}

function requireCompleteArticle({ title, content }, status) {
  if (!title?.trim() || !content?.trim()) {
    throw ApiError.badRequest(
      `Title and content are required when status is ${status}.`,
    );
  }
}

function buildArticleCreateData(authorId, payload, slug) {
  const {
    title,
    content,
    summary,
    coverImage,
    tags,
    status,
    scheduledAt,
    isAiGenerated,
  } = payload;

  const normalizedStatus = normalizeArticleStatus(status);

  if (normalizedStatus !== ARTICLE_STATUS.EDITING) {
    requireCompleteArticle({ title, content }, normalizedStatus);
  }

  const articleData = {
    title: title?.trim() || "Untitled",
    slug,
    content: content || "",
    summary: summary?.trim() || null,
    coverImage: coverImage || null,
    tags: Array.isArray(tags) ? tags : [],
    readingTime: calculateReadingTime(content || ""),
    isAiGenerated: Boolean(isAiGenerated),
    status: normalizedStatus,
    authorId,
  };

  if (normalizedStatus === ARTICLE_STATUS.PUBLISHED) {
    articleData.publishedAt = new Date();
  }

  if (normalizedStatus === ARTICLE_STATUS.SCHEDULED) {
    if (!scheduledAt) {
      throw ApiError.badRequest(
        "scheduledAt is required when status is SCHEDULED.",
      );
    }
    articleData.scheduledAt = new Date(scheduledAt);
  }

  return articleData;
}

function buildArticleUpdateData(existingArticle, payload) {
  const {
    title,
    content,
    summary,
    coverImage,
    tags,
    status,
    scheduledAt,
  } = payload;

  const updateData = {};

  const nextTitle =
    title !== undefined ? title?.trim() || "" : existingArticle.title;
  const nextContent =
    content !== undefined ? content || "" : existingArticle.content;

  const normalizedStatus =
    status !== undefined
      ? normalizeArticleStatus(status)
      : existingArticle.status;

  if (normalizedStatus !== ARTICLE_STATUS.EDITING) {
    requireCompleteArticle(
      { title: nextTitle, content: nextContent },
      normalizedStatus,
    );
  }

  if (title !== undefined) {
    updateData.title = nextTitle || "Untitled";
  }

  if (content !== undefined) {
    updateData.content = nextContent;
    updateData.readingTime = calculateReadingTime(nextContent);
  }

  if (summary !== undefined) {
    updateData.summary = summary?.trim() || null;
  }

  if (coverImage !== undefined) {
    updateData.coverImage = coverImage || null;
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      throw ApiError.badRequest("tags must be an array.");
    }
    updateData.tags = tags;
  }

  if (status !== undefined && normalizedStatus !== existingArticle.status) {
    updateData.status = normalizedStatus;

    if (normalizedStatus === ARTICLE_STATUS.PUBLISHED) {
      updateData.publishedAt = new Date();
    }

    if (normalizedStatus === ARTICLE_STATUS.SCHEDULED) {
      if (!scheduledAt) {
        throw ApiError.badRequest(
          "scheduledAt is required when status is SCHEDULED.",
        );
      }
      updateData.scheduledAt = new Date(scheduledAt);
    }
  }

  return updateData;
}

async function incrementPublishedArticleCount(userId) {
  await prisma.userStats.upsert({
    where: { userId },
    update: { articleCount: { increment: 1 } },
    create: { userId, articleCount: 1 },
  });
}

async function decrementPublishedArticleCount(userId) {
  await prisma.userStats
    .update({
      where: { userId },
      data: { articleCount: { decrement: 1 } },
    })
    .catch(() => {});
}

async function getArticleById(articleId, userId) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!article) {
    throw ApiError.notFound("Article not found.");
  }

  if (article.authorId !== userId) {
    throw ApiError.forbidden("You can only access your own articles.");
  }

  return article;
}

async function getCurrentEditingArticle(userId) {
  const article = await prisma.article.findFirst({
    where: {
      authorId: userId,
      status: ARTICLE_STATUS.EDITING,
    },
    orderBy: {
      updatedAt: "desc",
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  return article || null;
}

/*
 Create a new article.
 */
async function createArticle(authorId, payload) {
  const normalizedStatus = normalizeArticleStatus(payload.status);

  const baseTitle = payload.title?.trim() || "Untitled";
  const slug = await generateUniqueSlug(baseTitle);
  const articleData = buildArticleCreateData(authorId, payload, slug);

  const article = await prisma.article.create({
    data: articleData,
    include: {
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (normalizedStatus === ARTICLE_STATUS.PUBLISHED) {
    await incrementPublishedArticleCount(authorId);
  }

  return article;
}

/*
 Get a single article by slug.
 */
async function getArticleBySlug(slug, currentUserId = null) {
  const article = await prisma.article.findUnique({
    where: { slug },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          isPremium: true,
        },
      },
      comments: {
        where: { parentId: null },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          replies: {
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      _count: {
        select: {
          comments: true,
          likes: true,
          shares: true,
        },
      },
    },
  });

  if (!article) {
    throw ApiError.notFound("Article not found.");
  }

  let isLiked = false;
  let isSaved = false;

  if (currentUserId) {
    const [like, saved] = await Promise.all([
      prisma.articleLike.findUnique({
        where: {
          userId_articleId: {
            userId: currentUserId,
            articleId: article.id,
          },
        },
      }),
      prisma.savedArticle.findUnique({
        where: {
          userId_articleId: {
            userId: currentUserId,
            articleId: article.id,
          },
        },
      }),
    ]);

    isLiked = Boolean(like);
    isSaved = Boolean(saved);
  }

  return { ...article, isLiked, isSaved };
}

/*
  Get published articles feed.
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
    status: ARTICLE_STATUS.PUBLISHED,
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
      ? [{ likeCount: "desc" }, { readCount: "desc" }]
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
            likes: true,
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
  Update an article.
 */
async function updateArticle(articleId, authorId, payload) {
  const existingArticle = await prisma.article.findUnique({
    where: { id: articleId },
  });

  if (!existingArticle) {
    throw ApiError.notFound("Article not found.");
  }

  if (existingArticle.authorId !== authorId) {
    throw ApiError.forbidden("You can only edit your own articles.");
  }

  const updateData = buildArticleUpdateData(existingArticle, payload);

  if (
    payload.title !== undefined &&
    payload.title.trim() !== existingArticle.title
  ) {
    updateData.slug = await generateUniqueSlug(
      payload.title.trim() || "Untitled",
    );
  }

  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: updateData,
    include: {
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  const wasPublished = existingArticle.status === ARTICLE_STATUS.PUBLISHED;
  const isPublished = updatedArticle.status === ARTICLE_STATUS.PUBLISHED;

  if (!wasPublished && isPublished) {
    await incrementPublishedArticleCount(authorId);
  }

  return updatedArticle;
}

/*
  Delete an article.
 */
async function deleteArticle(articleId, userId, userRole) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
  });

  if (!article) {
    throw ApiError.notFound("Article not found.");
  }

  if (article.authorId !== userId && userRole !== "ADMIN") {
    throw ApiError.forbidden("You can only delete your own articles.");
  }

  await prisma.article.delete({
    where: { id: articleId },
  });

  if (article.status === ARTICLE_STATUS.PUBLISHED) {
    await decrementPublishedArticleCount(article.authorId);
  }

  return { deleted: true };
}

/*
  Record a read on an article.
 */
async function recordRead(articleId, userId) {
  await prisma.readHistory.upsert({
    where: {
      userId_articleId: { userId, articleId },
    },
    update: {
      lastReadAt: new Date(),
      readCount: { increment: 1 },
    },
    create: {
      userId,
      articleId,
    },
  });

  await prisma.article.update({
    where: { id: articleId },
    data: { readCount: { increment: 1 } },
  });

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorId: true },
  });

  if (article) {
    await prisma.userStats.upsert({
      where: { userId: article.authorId },
      update: { totalReads: { increment: 1 } },
      create: { userId: article.authorId, totalReads: 1 },
    });
  }
}

/*
  Get only intentional drafts.
  EDITING articles are excluded from this list.
 */
async function getUserDrafts(userId, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const where = {
    authorId: userId,
    status: ARTICLE_STATUS.DRAFT,
  };

  const [drafts, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.article.count({ where }),
  ]);

  return { drafts, total };
}

module.exports = {
  createArticle,
  getArticleById,
  getCurrentEditingArticle,
  getArticleBySlug,
  getArticleFeed,
  updateArticle,
  deleteArticle,
  recordRead,
  getUserDrafts,
};