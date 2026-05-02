/* src/services/article/article.helpers.js */

const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");
const {
  calculateReadingTime,
} = require("../../utils/helpers");
const { ARTICLE_STATUS, MAX_TAGS } = require("./article.constants");
	
/*
 Normalizes and validates article status.
 */
function normalizeArticleStatus(status) {
  if (!status) return ARTICLE_STATUS.EDITING;

  const normalized = String(status).trim().toUpperCase();

  switch (normalized) {
    // EDITING is the initial state when a user starts writing.
    case ARTICLE_STATUS.EDITING:
      return ARTICLE_STATUS.EDITING;
    // DRAFT is a saved state that is not yet visible to the public.
    case ARTICLE_STATUS.DRAFT:
      return ARTICLE_STATUS.DRAFT;
    // PUBLISHED makes the article visible to everyone.
    case ARTICLE_STATUS.PUBLISHED:
      return ARTICLE_STATUS.PUBLISHED;
    // SCHEDULED marks an article to be published at a future date.
    case ARTICLE_STATUS.SCHEDULED:
      return ARTICLE_STATUS.SCHEDULED;
    default:
      throw ApiError.badRequest(`Invalid article status: ${status}`);
  }
}

/*
 Ensures title and content are present for non-EDITING statuses. 
 We allow empty fields in EDITING mode to support smooth autosaving 
 while the user is still brainstorming or typing.
 */
function requireCompleteArticle({ title, content }, status) {
  if (!title?.trim() || !content?.trim()) {
    throw ApiError.badRequest(
      `Title and content are required when status is ${status}.`,
    );
  }
}

/*
 Normalizes, dedupes, and validates tags.
 */
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

/*
 Parses and validates scheduled date.
 */
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

/*
 Builds payload for existing article edits.
 */
function buildEditExistingPayload(payload) {
  return {
    title: payload.title?.trim() || "Untitled",
    content: payload.content || "",
    coverImage: payload.coverImage || null,
    readingTime: calculateReadingTime(payload.content || ""),
  };
}

/*
 Builds payload for "Edit As New" (cloning).
 */
function buildEditAsNewPayload(article, payload) {
  return {
    title: article.title,
    content: payload.content || "",
    coverImage: payload.coverImage || null,
    readingTime: calculateReadingTime(payload.content || ""),
  };
}

/*
 Resets backup fields.
 */
function buildClearedEditingBackupData() {
  return {
    editingBackupTitle: null,
    editingBackupContent: null,
    editingBackupCoverImage: null,
    editingStartedAt: null,
  };
}

/*
 Checks if article content has changed.
 */
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

/*
 Handles complex timestamp and isEdited logic for existing article edits.
 */
function applyEditExistingTimestamp(article, updateData) {
  const originalTitle = article.editingBackupTitle ?? article.title;
  const originalContent = article.editingBackupContent ?? article.content;
  const originalCoverImage = article.editingBackupCoverImage ?? article.coverImage;

  const hasMeaningfulChanges =
    (updateData.title !== undefined && updateData.title !== originalTitle) ||
    (updateData.content !== undefined && updateData.content !== originalContent) ||
    (updateData.coverImage !== undefined && updateData.coverImage !== originalCoverImage) ||
    (updateData.tags !== undefined && JSON.stringify(updateData.tags) !== JSON.stringify(article.tags));

  updateData.updatedAt = hasMeaningfulChanges
    ? new Date()
    : article.editingStartedAt || article.updatedAt;

  updateData.isEdited = article.isEdited || hasMeaningfulChanges;

  return updateData;
}

/*
 Ownership and existence check.
 */
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

/*
 Stats: Increment published count.
 */
async function incrementPublishedArticleCount(userId) {
  await prisma.userStats.upsert({
    where: { userId },
    update: { articleCount: { increment: 1 } },
    create: { userId, articleCount: 1 },
  });
}

/*
 Stats: Decrement published count.
 */
async function decrementPublishedArticleCount(userId) {
  await prisma.userStats
    .update({
      where: { userId },
      data: { articleCount: { decrement: 1 } },
    })
    .catch(() => { });
}

/*
 Assembles data for new article creation.
 */
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

/*
 Assembles data for article updates.
 */
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

module.exports = {
  normalizeArticleStatus,
  requireCompleteArticle,
  normalizeTags,
  parseScheduledAt,
  buildEditExistingPayload,
  buildEditAsNewPayload,
  buildClearedEditingBackupData,
  shouldUpdateArticleTimestamp,
  applyEditExistingTimestamp,
  getOwnedArticleOrThrow,
  incrementPublishedArticleCount,
  decrementPublishedArticleCount,
  buildArticleCreateData,
  buildArticleUpdateData,
};
