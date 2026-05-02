/* src/services/article/article.core.service.js */

const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");
const { generateUniqueSlug } = require("../../utils/helpers");
const {	
  ARTICLE_STATUS,
  BASIC_AUTHOR_SELECT,
  ARTICLE_AUTHOR_INCLUDE,
} = require("./article.constants");
const {
  getOwnedArticleOrThrow,
  buildArticleCreateData,
  buildArticleUpdateData,
  shouldUpdateArticleTimestamp,
  incrementPublishedArticleCount,
  decrementPublishedArticleCount,
} = require("./article.helpers");

/*
 Fetches an article by ID. Ownership check is required here to prevent 
 unauthorized access to private drafts or editing backups.
 */
async function getArticleById(articleId, userId) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  if (!article) {
    throw ApiError.notFound("Article not found.");
  }

  if (article.authorId !== userId) {
    throw ApiError.forbidden("You can only access your own articles.");
  }

  return article;
}

/*
 Fetches the most recent article in the EDITING state. This allows the 
 frontend to automatically resume a user's last unsaved session.
 */
async function getCurrentEditingArticle(userId) {
  const article = await prisma.article.findFirst({
    where: {
      authorId: userId,
      status: ARTICLE_STATUS.EDITING,
    },
    orderBy: {
      updatedAt: "desc",
    },
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  return article || null;
}

/*
 Creates a new article.
 */
async function createArticle(authorId, payload) {
  const baseTitle = payload.title?.trim() || "Untitled";
  const slug = await generateUniqueSlug(baseTitle);
  const articleData = buildArticleCreateData(authorId, payload, slug);

  const article = await prisma.article.create({
    data: articleData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  if (article.status === ARTICLE_STATUS.PUBLISHED) {
    await incrementPublishedArticleCount(authorId);
  }

  return article;
}

/*
 Fetches an article by slug (public/auth).
 */
async function getArticleBySlug(slug, currentUserId = null) {
  const article = await prisma.article.findUnique({
    where: { slug },
    include: {
      author: {
        select: {
          ...BASIC_AUTHOR_SELECT,
          isPremium: true,
        },
      },
      comments: {
        where: { parentId: null },
        include: {
          author: {
            select: BASIC_AUTHOR_SELECT,
          },
          replies: {
            include: {
              author: {
                select: BASIC_AUTHOR_SELECT,
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
          shares: true,
          savedBy: true,
        },
      },
    },
  });

  if (!article) {
    throw ApiError.notFound("Article not found.");
  }

  let isSaved = false;

  if (currentUserId) {
    const saved = await prisma.savedArticle.findUnique({
      where: {
        userId_articleId: {
          userId: currentUserId,
          articleId: article.id,
        },
      },
    });

    isSaved = Boolean(saved);
  }

  return { ...article, isSaved };
}

/*
 General article update. We only refresh the 'updatedAt' timestamp if 
 meaningful content changed to avoid misleading readers with "fake" updates.
 */
async function updateArticle(articleId, authorId, payload) {
  const existingArticle = await getOwnedArticleOrThrow(articleId, authorId);
  const updateData = buildArticleUpdateData(existingArticle, payload);

  if (shouldUpdateArticleTimestamp(existingArticle, updateData)) {
    updateData.updatedAt = new Date();
  }

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
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  const wasPublished = existingArticle.status === ARTICLE_STATUS.PUBLISHED;
  const isPublished = updatedArticle.status === ARTICLE_STATUS.PUBLISHED;

  if (!wasPublished && isPublished) {
    await incrementPublishedArticleCount(authorId);
  }

  return updatedArticle;
}

/*
 Deletes an article. We only decrement the user's published count 
 if the article was actually in a PUBLISHED state.
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
 Records a read interaction.
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

module.exports = {
  createArticle,
  getArticleById,
  getCurrentEditingArticle,
  getArticleBySlug,
  updateArticle,
  deleteArticle,
  recordRead,
};
