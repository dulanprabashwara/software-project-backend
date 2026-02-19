const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const {
  generateUniqueSlug,
  calculateReadingTime,
} = require("../utils/helpers");

/**
 * Create a new article.
 */
const createArticle = async (authorId, data) => {
  const {
    title,
    content,
    summary,
    coverImage,
    tags,
    status,
    scheduledAt,
    isAiGenerated,
  } = data;

  if (!title || !content) {
    throw ApiError.badRequest("Title and content are required.");
  }

  const slug = await generateUniqueSlug(title);
  const readingTime = calculateReadingTime(content);

  const articleData = {
    title,
    slug,
    content,
    summary: summary || null,
    coverImage: coverImage || null,
    tags: tags || [],
    readingTime,
    isAiGenerated: isAiGenerated || false,
    status: status || "DRAFT",
    authorId,
  };

  // Handle scheduling and publishing
  if (status === "PUBLISHED") {
    articleData.publishedAt = new Date();
  } else if (status === "SCHEDULED" && scheduledAt) {
    articleData.scheduledAt = new Date(scheduledAt);
  }

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

  // Update user's article count
  if (status === "PUBLISHED") {
    await prisma.userStats.upsert({
      where: { userId: authorId },
      update: { articleCount: { increment: 1 } },
      create: { userId: authorId, articleCount: 1 },
    });
  }

  return article;
};

/**
 * Get a single article by slug.
 */
const getArticleBySlug = async (slug, currentUserId = null) => {
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
        where: { parentId: null }, // Only top-level comments
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
        select: { comments: true, likes: true, shares: true },
      },
    },
  });

  if (!article) throw ApiError.notFound("Article not found.");

  // Check if current user has liked or saved this article
  let isLiked = false;
  let isSaved = false;
  if (currentUserId) {
    const [like, saved] = await Promise.all([
      prisma.articleLike.findUnique({
        where: {
          userId_articleId: { userId: currentUserId, articleId: article.id },
        },
      }),
      prisma.savedArticle.findUnique({
        where: {
          userId_articleId: { userId: currentUserId, articleId: article.id },
        },
      }),
    ]);
    isLiked = !!like;
    isSaved = !!saved;
  }

  return { ...article, isLiked, isSaved };
};

/**
 * Get published articles feed with pagination.
 */
const getArticleFeed = async ({
  page = 1,
  limit = 10,
  tag,
  authorId,
  search,
  sortBy = "latest",
}) => {
  const skip = (page - 1) * limit;

  const where = { status: "PUBLISHED" };

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
        _count: { select: { comments: true, likes: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.article.count({ where }),
  ]);

  return { articles, total };
};

/**
 * Update an article.
 */
const updateArticle = async (articleId, authorId, data) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });

  if (!article) throw ApiError.notFound("Article not found.");
  if (article.authorId !== authorId)
    throw ApiError.forbidden("You can only edit your own articles.");

  const { title, content, summary, coverImage, tags, status, scheduledAt } =
    data;

  const updateData = {};

  if (title) {
    updateData.title = title;
    // Only regenerate slug if title changed
    if (title !== article.title) {
      updateData.slug = await generateUniqueSlug(title);
    }
  }
  if (content) {
    updateData.content = content;
    updateData.readingTime = calculateReadingTime(content);
  }
  if (summary !== undefined) updateData.summary = summary;
  if (coverImage !== undefined) updateData.coverImage = coverImage;
  if (tags) updateData.tags = tags;

  // Handle status transitions
  if (status && status !== article.status) {
    updateData.status = status;
    if (status === "PUBLISHED" && article.status !== "PUBLISHED") {
      updateData.publishedAt = new Date();
      // Increment article count
      await prisma.userStats.upsert({
        where: { userId: authorId },
        update: { articleCount: { increment: 1 } },
        create: { userId: authorId, articleCount: 1 },
      });
    }
    if (status === "SCHEDULED" && scheduledAt) {
      updateData.scheduledAt = new Date(scheduledAt);
    }
  }

  const updated = await prisma.article.update({
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

  return updated;
};

/**
 * Delete an article (only by author or admin).
 */
const deleteArticle = async (articleId, userId, userRole) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });

  if (!article) throw ApiError.notFound("Article not found.");
  if (article.authorId !== userId && userRole !== "ADMIN") {
    throw ApiError.forbidden("You can only delete your own articles.");
  }

  await prisma.article.delete({ where: { id: articleId } });

  // Decrement article count if it was published
  if (article.status === "PUBLISHED") {
    await prisma.userStats
      .update({
        where: { userId: article.authorId },
        data: { articleCount: { decrement: 1 } },
      })
      .catch(() => {}); // Ignore if stats don't exist
  }

  return { deleted: true };
};

/**
 * Record a read on an article.
 */
const recordRead = async (articleId, userId) => {
  // Upsert read history
  await prisma.readHistory.upsert({
    where: { userId_articleId: { userId, articleId } },
    update: { lastReadAt: new Date(), readCount: { increment: 1 } },
    create: { userId, articleId },
  });

  // Increment article read count
  await prisma.article.update({
    where: { id: articleId },
    data: { readCount: { increment: 1 } },
  });

  // Update author's total reads
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
};

/**
 * Get user's draft articles.
 */
const getUserDrafts = async (userId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [drafts, total] = await Promise.all([
    prisma.article.findMany({
      where: { authorId: userId, status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.article.count({
      where: { authorId: userId, status: "DRAFT" },
    }),
  ]);

  return { drafts, total };
};

module.exports = {
  createArticle,
  getArticleBySlug,
  getArticleFeed,
  updateArticle,
  deleteArticle,
  recordRead,
  getUserDrafts,
};
