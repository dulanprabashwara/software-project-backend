/* software-project-backend/src/services/article.service.js */

const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const {
  generateUniqueSlug,
  calculateReadingTime,
} = require("../utils/helpers");

// Keep article status values in one place to avoid typo-based bugs.
const ARTICLE_STATUS = Object.freeze({ 
  EDITING: "EDITING",
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  SCHEDULED: "SCHEDULED",
});

const MAX_TAGS = 5;

// Reuse the same author fields across article queries so response shape stays consistent.
const BASIC_AUTHOR_SELECT = { 
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
};

const ARTICLE_AUTHOR_INCLUDE = {
  author: {
    select: BASIC_AUTHOR_SELECT,
  },
};

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

// Normalize tags before saving so duplicate tags with different casing are treated as the same tag.
function normalizeTags(tags) {
  if (tags === undefined) {
    return undefined;
  }

  if (!Array.isArray(tags)) {
    throw ApiError.badRequest("tags must be an array.");
  }

  const normalized = tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .filter((tag, index, array) => {
      return array.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index;
    });

  if (normalized.length === 0) {
    throw ApiError.badRequest("At least one tag is required.");
  }

  if (normalized.length > MAX_TAGS) {
    throw ApiError.badRequest(`You can add up to ${MAX_TAGS} tags only.`);
  }

  return normalized;
}

// Scheduled articles must have a valid future date before they can be saved.
function parseScheduledAt(value) {
  if (!value) {
    throw ApiError.badRequest("scheduledAt is required when scheduling an article.");
  }

  const scheduledAt = new Date(value);

  if (Number.isNaN(scheduledAt.getTime())) {
    throw ApiError.badRequest("Invalid scheduledAt value.");
  }

  if (scheduledAt <= new Date()) {
    throw ApiError.badRequest("Scheduled time must be in the future.");
  }

  return scheduledAt;
}

// These fields store the original article before edit-existing starts.
function buildEditExistingPayload(payload) {
  return {
    title: payload.title?.trim() || "Untitled",
    content: payload.content || "",
    coverImage: payload.coverImage || null,
    readingTime: calculateReadingTime(payload.content || ""),
  };
}

function buildEditAsNewPayload(article, payload) {
  return {
    title: article.title,
    content: payload.content || "",
    coverImage: payload.coverImage || null,
    readingTime: calculateReadingTime(payload.content || ""),
  };
}

function buildClearedEditingBackupData() {
  return {
    editingBackupTitle: null,
    editingBackupContent: null,
    editingBackupCoverImage: null,
    editingStartedAt: null,
  };
}

// Only update the timestamp when visible article content actually changed.
function shouldUpdateArticleTimestamp(existingArticle, updateData) {
  return (
    (updateData.title !== undefined && updateData.title !== existingArticle.title) ||
    (updateData.content !== undefined && updateData.content !== existingArticle.content) ||
    (updateData.summary !== undefined && updateData.summary !== existingArticle.summary) ||
    (updateData.coverImage !== undefined && updateData.coverImage !== existingArticle.coverImage) ||
    (updateData.tags !== undefined &&
      JSON.stringify(updateData.tags) !== JSON.stringify(existingArticle.tags))
  );
}

// Compare edited content with the original backup, not the current edited row.
function applyEditExistingTimestamp(article, updateData) {
  const originalTitle = article.editingBackupTitle ?? article.title;
  const originalContent = article.editingBackupContent ?? article.content;
  const originalCoverImage =
    article.editingBackupCoverImage ?? article.coverImage;

  const hasMeaningfulChanges =
    updateData.title !== originalTitle ||
    updateData.content !== originalContent ||
    updateData.coverImage !== originalCoverImage;

  updateData.updatedAt = hasMeaningfulChanges
    ? new Date()
    : article.editingStartedAt || article.updatedAt;

  return updateData;
}

// Most edit actions require both ownership and existence checks.
async function getOwnedArticleOrThrow(articleId, userId) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
  });

  if (!article) {
    throw ApiError.notFound("Article not found.");
  }

  if (article.authorId !== userId) {
    throw ApiError.forbidden("You can only edit your own articles.");
  }

  return article;
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
    articleData.scheduledAt = parseScheduledAt(scheduledAt);
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
    updateData.tags = normalizeTags(tags);
  }

  if (status !== undefined && normalizedStatus !== existingArticle.status) {
    updateData.status = normalizedStatus;

    if (normalizedStatus === ARTICLE_STATUS.PUBLISHED) {
      updateData.publishedAt = new Date();
      updateData.scheduledAt = null;
    }

    if (normalizedStatus === ARTICLE_STATUS.SCHEDULED) {
      updateData.scheduledAt = parseScheduledAt(scheduledAt);
      updateData.publishedAt = null;
    }

    if (
      normalizedStatus === ARTICLE_STATUS.DRAFT ||
      normalizedStatus === ARTICLE_STATUS.EDITING
    ) {
      updateData.scheduledAt = null;
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

async function startExistingArticleEditing(articleId, userId) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  if (article.status === ARTICLE_STATUS.PUBLISHED) {
    throw ApiError.badRequest(
      "Published articles cannot be edited from this page.",
    );
  }
  // Create a backup only when starting a fresh edit-existing session.
  const shouldCreateBackup = article.status === ARTICLE_STATUS.DRAFT && !article.editingStartedAt;

  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: {
      status: ARTICLE_STATUS.EDITING,
      ...(shouldCreateBackup
        ? {
            editingBackupTitle: article.title,
            editingBackupContent: article.content,
            editingBackupCoverImage: article.coverImage,
            editingStartedAt: article.updatedAt,
          }
        : {}),
    },
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  return updatedArticle;
}

async function saveExistingArticleForPreview(articleId, userId, payload) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  const nextTitle = payload.title?.trim() || "";
  const nextContent = payload.content || "";

  requireCompleteArticle(
    {
      title: nextTitle,
      content: nextContent,
    },
    ARTICLE_STATUS.DRAFT,
  );

  const updateData = {
    ...buildEditExistingPayload(payload),
    status: ARTICLE_STATUS.DRAFT,
    isEdited: true,

  };

  if (nextTitle && nextTitle !== article.title) {
    updateData.slug = await generateUniqueSlug(nextTitle);
  }

  // Preview saves should not change updatedAt if the article matches its backup.
  applyEditExistingTimestamp(article, updateData);


  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: updateData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });
  return updatedArticle;
}

async function startEditAsNewArticle(sourceArticleId, userId) {
  const sourceArticle = await getOwnedArticleOrThrow(sourceArticleId, userId);

  if (sourceArticle.status === ARTICLE_STATUS.PUBLISHED) {
    throw ApiError.badRequest(
      "Published articles cannot be edited as new from this page.",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingCopies = await tx.article.findMany({
      where: {
        authorId: userId,
        status: ARTICLE_STATUS.EDITING,
        isEditAsNew: true,
        sourceArticleId,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: ARTICLE_AUTHOR_INCLUDE,
    });

    if (existingCopies.length > 0) {
      const [primaryCopy, ...duplicateCopies] = existingCopies;

      if (duplicateCopies.length > 0) {
        await tx.article.deleteMany({
          where: {
            id: {
              in: duplicateCopies.map((article) => article.id),
            },
          },
        });
      }

      return primaryCopy;
    }

    const slug = await generateUniqueSlug(
      sourceArticle.title?.trim() || "Untitled",
    );

    return tx.article.create({
      data: {
        title: sourceArticle.title,
        slug,
        content: "",
        summary: null,
        coverImage: null,
        tags: Array.isArray(sourceArticle.tags) ? sourceArticle.tags : [],
        readingTime: 0,
        status: ARTICLE_STATUS.EDITING,
        isAiGenerated: Boolean(sourceArticle.isAiGenerated),
        isEditAsNew: true,
        sourceArticleId: sourceArticle.id,
        authorId: userId,
      },
      include: ARTICLE_AUTHOR_INCLUDE,
    });
  });

  return result;
}

async function createArticle(authorId, payload) {
  const normalizedStatus = normalizeArticleStatus(payload.status);

  const baseTitle = payload.title?.trim() || "Untitled";
  const slug = await generateUniqueSlug(baseTitle);
  const articleData = buildArticleCreateData(authorId, payload, slug);

  const article = await prisma.article.create({
    data: articleData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  if (normalizedStatus === ARTICLE_STATUS.PUBLISHED) {
    await incrementPublishedArticleCount(authorId);
  }

  return article;
}

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

async function getUserPublishedArticles(userId, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const where = {
    authorId: userId,
    status: ARTICLE_STATUS.PUBLISHED,
  };

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
      include: {
        ...ARTICLE_AUTHOR_INCLUDE,
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
    status: ARTICLE_STATUS.PUBLISHED,
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

async function publishArticle(articleId, userId, payload) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  if (article.status === ARTICLE_STATUS.PUBLISHED) {
    throw ApiError.badRequest("This article is already published.");
  }

  requireCompleteArticle(
    {
      title: article.title,
      content: article.content,
    },
    ARTICLE_STATUS.PUBLISHED,
  );

  const tags = normalizeTags(payload.tags);
  const timing = String(payload.timing || "now").trim().toLowerCase(); //// Publishing supports either immediate publish or scheduling for later.

  if (timing !== "now" && timing !== "schedule") {
    throw ApiError.badRequest("timing must be either 'now' or 'schedule'.");
  }

  const updateData = {
    tags,
  };

  if (timing === "schedule") {
    updateData.status = ARTICLE_STATUS.SCHEDULED;
    updateData.scheduledAt = parseScheduledAt(payload.scheduledAt);
    updateData.publishedAt = null;
  } else {
    updateData.status = ARTICLE_STATUS.PUBLISHED;
    updateData.publishedAt = new Date();
    updateData.scheduledAt = null;

    Object.assign(updateData, buildClearedEditingBackupData());
  }

  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: updateData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  if (
    article.status !== ARTICLE_STATUS.PUBLISHED &&
    updatedArticle.status === ARTICLE_STATUS.PUBLISHED
  ) {
    await incrementPublishedArticleCount(userId);
  }

  return updatedArticle;
}

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

async function autosaveExistingArticle(articleId, userId, payload) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  const updateData = {
    ...buildEditExistingPayload(payload),
    status: ARTICLE_STATUS.EDITING,
  };

  if (
    payload.title &&
    payload.title.trim() &&
    payload.title.trim() !== article.title
  ) {
    updateData.slug = await generateUniqueSlug(payload.title.trim());
  }

  // Autosave should preserve the original timestamp when edits are reverted.
  if (shouldUpdateArticleTimestamp(article, updateData)) {
    applyEditExistingTimestamp(article, updateData);
  }

  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: updateData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  return updatedArticle;
}

async function autosaveEditAsNewArticle(articleId, userId, payload) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  if (!article.isEditAsNew) {
    throw ApiError.badRequest("This article is not an edit-as-new article.");
  }

  const updateData = {
    ...buildEditAsNewPayload(article, payload),
    status: ARTICLE_STATUS.EDITING,
  };

  if (shouldUpdateArticleTimestamp(article, updateData)) {
    updateData.updatedAt = new Date();
  }

  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: updateData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  return updatedArticle;
}

async function discardExistingArticleEdits(articleId, userId) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  const restoredTitle = article.editingBackupTitle || article.title;
  const restoredContent = article.editingBackupContent ?? article.content;
  const restoredCoverImage = article.editingBackupCoverImage ?? article.coverImage;

  // Restore the article to the backup captured before editing started.
  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: {
      title: restoredTitle,
      content: restoredContent,
      coverImage: restoredCoverImage,
      readingTime: calculateReadingTime(restoredContent || ""),
      status: ARTICLE_STATUS.DRAFT,
      updatedAt: article.editingStartedAt || article.updatedAt,
      ...buildClearedEditingBackupData(),
    },
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  return updatedArticle;
}

async function discardEditAsNewArticle(articleId, userId) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  if (!article.isEditAsNew) {
    throw ApiError.badRequest("This article is not an edit-as-new article.");
  }

  await prisma.article.delete({
    where: { id: articleId },
  });

  return { deleted: true };
}

async function saveExistingArticleAsDraft(articleId, userId, payload) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  const nextTitle = payload.title?.trim() || "";
  const nextContent = payload.content || "";

  requireCompleteArticle(
    {
      title: nextTitle,
      content: nextContent,
    },
    ARTICLE_STATUS.DRAFT,
  );

  const updateData = {
    ...buildEditExistingPayload(payload),
    status: ARTICLE_STATUS.DRAFT,
    isEdited: true,
    ...buildClearedEditingBackupData(),
  };

  if (nextTitle && nextTitle !== article.title) {
    updateData.slug = await generateUniqueSlug(nextTitle);
  }

  // Compare with ORIGINAL article before editing started
  const originalTitle = article.editingBackupTitle ?? article.title;
  const originalContent = article.editingBackupContent ?? article.content;
  const originalCoverImage = article.editingBackupCoverImage ?? article.coverImage;

  const hasMeaningfulChanges =
    updateData.title !== originalTitle ||
    updateData.content !== originalContent ||
    updateData.coverImage !== originalCoverImage;

  if (hasMeaningfulChanges) 
    updateData.updatedAt = new Date(); // Real article changes happened
   else 
    updateData.updatedAt = article.editingStartedAt || article.updatedAt; // User removed all changes → restore old timestamp
  

  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: updateData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });
  return updatedArticle;

}

async function clearEditExistingBackup(articleId, userId) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  // Clearing backup fields is metadata cleanup, so keep the article timestamp unchanged.
  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: {
      ...buildClearedEditingBackupData(),
      updatedAt: article.updatedAt,
    },
  });

  return updatedArticle;
}

async function saveEditAsNewArticleAsDraft(articleId, userId, payload) {
  const article = await getOwnedArticleOrThrow(articleId, userId);

  if (!article.isEditAsNew) {
    throw ApiError.badRequest("This article is not an edit-as-new article.");
  }

  const nextContent = payload.content || "";

  requireCompleteArticle(
    {
      title: article.title,
      content: nextContent,
    },
    ARTICLE_STATUS.DRAFT,
  );

  const updateData = {
    ...buildEditAsNewPayload(article, payload),
    status: ARTICLE_STATUS.DRAFT,
    isEditAsNew: true,
  };

  if (shouldUpdateArticleTimestamp(article, updateData)) {
    updateData.updatedAt = new Date();
  }

  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: updateData,
    include: ARTICLE_AUTHOR_INCLUDE,
  });

  return updatedArticle;
}

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

// ─── GET TRENDING ARTICLES ────────────────────────────────────────────────────
// Returns top 10 PUBLISHED articles by trendingScore for the AI generator slider.

async function getTrendingArticles() {
  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { trendingScore: "desc" },
    take: 10,
    select: {
      id:            true,
      title:         true,
      summary:       true,
      coverImage:    true,
      publishedAt:   true,
      createdAt:     true,
      averageRating: true,
      ratingCount:   true,
      commentCount:  true,
      readingTime:   true,
      author: {
        select: {
          displayName: true,
          username:    true,
          avatarUrl:   true,
          isPremium:   true,
        },
      },
    },
  });
  return articles;
}

module.exports = {
  createArticle,
  getArticleById,
  getCurrentEditingArticle,
  getArticleBySlug,
  getArticleFeed,
  getUserPublishedArticles,
  getPublishedArticlesByUsername,
  getUserScheduledArticles,
  publishArticle,
  updateArticle,
  startExistingArticleEditing,
  autosaveExistingArticle,
  discardExistingArticleEdits,
  saveExistingArticleAsDraft,
  saveExistingArticleForPreview,
  startEditAsNewArticle,
  autosaveEditAsNewArticle,
  discardEditAsNewArticle,
  clearEditExistingBackup,
  saveEditAsNewArticleAsDraft,
  deleteArticle,
  recordRead,
  getUserDrafts,
  getTrendingArticles,
};