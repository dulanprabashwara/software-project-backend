//@ts-nocheck
/**
 * ai.logs.service.js
 *
 * Manages AI article log lifecycle:
 *   - saveDraft       — persist an AI log as a DRAFT article
 *   - loadToEditor    — open a log in the TinyMCE editor (EDITING status)
 *   - softDeleteLog   — mark a log as deleted (restorable within 1 hour)
 *   - restoreLog      — un-delete within the restore window
 *   - getArticleLogs  — list active logs (also runs hourly cleanup)
 *   - getArticleLogById
 *   - setUserResponse — like / dislike toggle
 */

const { v4: uuidv4 } = require("uuid");
const prisma = require("../config/prisma");
const { generateUniqueSlug, calculateReadingTime } = require("../utils/helpers");
const { SUMMARY_EXCERPT_LENGTH } = require("./ai.generation.service");

// ── Constants ─────────────────────────────────────────────────────────────────

const MS_PER_SECOND    = 1000;
const MS_PER_MINUTE    = 60 * MS_PER_SECOND;
const MS_PER_HOUR      = 60 * MS_PER_MINUTE;
const RESTORE_WINDOW_MS = MS_PER_HOUR; // soft-deleted logs expire after 1 hour

// ── saveDraft ──────────────────────────────────────────────────────────────────

async function saveDraft({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found. It may have expired. Please regenerate.");
  if (log.authorId && log.authorId !== authorId) throw new Error("You can only save your own articles.");

  if (log.linkedArticleId) {
    const existingArticle = await prisma.article.findUnique({
      where:   { id: log.linkedArticleId },
      include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
    if (existingArticle?.status === "EDITING") {
      const draft = await prisma.article.update({
        where:   { id: existingArticle.id },
        data:    { status: "DRAFT" },
        include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      });
      return { draft, alreadySaved: false };
    }
    return { draft: existingArticle, alreadySaved: true };
  }

  const slug        = await generateUniqueSlug(log.articleTitle);
  const readingTime = calculateReadingTime(log.articleContent);

  const draft = await prisma.article.create({
    data: {
      title:         log.articleTitle,
      slug,
      content:       log.articleContent,
      summary:       log.articleContent.slice(0, SUMMARY_EXCERPT_LENGTH).replace(/\n/g, " ") + "...",
      status:        "DRAFT",
      isAiGenerated: true,
      readingTime,
      tags:          [],
      authorId,
    },
    include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
  });

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { linkedArticleId: draft.id },
  });

  return { draft, alreadySaved: false };
}

// ── loadToEditor ───────────────────────────────────────────────────────────────

async function loadToEditor({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found.");
  if (log.authorId && log.authorId !== authorId) throw new Error("You can only edit your own articles.");

  if (log.linkedArticleId) {
    const article = await prisma.article.update({
      where: { id: log.linkedArticleId },
      data:  { status: "EDITING", updatedAt: new Date() },
    });
    return { articleId: article.id };
  }

  const slug        = await generateUniqueSlug(log.articleTitle);
  const readingTime = calculateReadingTime(log.articleContent);

  const article = await prisma.article.create({
    data: {
      title:         log.articleTitle,
      slug,
      content:       log.articleContent,
      summary:       log.articleContent.slice(0, SUMMARY_EXCERPT_LENGTH).replace(/\n/g, " ") + "...",
      status:        "EDITING",
      isAiGenerated: true,
      readingTime,
      tags:          [],
      coverImage:    null,
      authorId,
    },
  });

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { linkedArticleId: article.id },
  });

  return { articleId: article.id };
}

// ── softDeleteLog ──────────────────────────────────────────────────────────────
// Sets deletedAt = now(). Disappears from list immediately.
// Can be restored within RESTORE_WINDOW_MS. After that, permanently deleted
// by the cleanup that runs at the start of every getArticleLogs call.

async function softDeleteLog({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article not found.");
  if (log.authorId !== authorId) throw new Error("You can only delete your own articles.");

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { deletedAt: new Date() },
  });
}

// ── restoreLog ─────────────────────────────────────────────────────────────────
// Clears deletedAt so the article reappears in the list.
// Fails if more than RESTORE_WINDOW_MS has passed.

async function restoreLog({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article not found. It may have been permanently deleted.");
  if (log.authorId !== authorId) throw new Error("You can only restore your own articles.");
  if (!log.deletedAt) throw new Error("This article is not deleted.");

  const restoreDeadline = new Date(Date.now() - RESTORE_WINDOW_MS);
  if (log.deletedAt < restoreDeadline) {
    throw new Error("Restore window has expired. This article has been permanently deleted.");
  }

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { deletedAt: null },
  });
}

// ── getArticleLogs ─────────────────────────────────────────────────────────────
// First permanently deletes soft-deleted entries older than RESTORE_WINDOW_MS.
// Then returns only active (not soft-deleted) unsaved articles.

async function getArticleLogs(authorId) {
  const restoreDeadline = new Date(Date.now() - RESTORE_WINDOW_MS);
  await prisma.ai_article_logs.deleteMany({
    where: {
      authorId,
      deletedAt: { not: null, lte: restoreDeadline },
    },
  }).catch((err) => console.error("[AI] Cleanup failed:", err.message));

  return prisma.ai_article_logs.findMany({
    where: {
      authorId,
      linkedArticleId: null,
      deletedAt:       null,
    },
    orderBy: { generatedAt: "desc" },
    select: {
      id:             true,
      articleTitle:   true,
      generatedAt:    true,
      wordCount:      true,
      articleLength:  true,
      tone:           true,
      aiInputTokens:  true,
      aiOutputTokens: true,
    },
  });
}

// ── getArticleLogById ──────────────────────────────────────────────────────────

async function getArticleLogById(id, authorId) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id } });
  if (!log) throw new Error("Article not found.");
  if (log.authorId && log.authorId !== authorId) throw new Error("You do not have permission to view this article.");
  return log;
}

// ── setUserResponse ────────────────────────────────────────────────────────────
// Sets or clears (toggles) the user's like/dislike reaction.

async function setUserResponse({ logId, authorId, response }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found.");
  if (log.authorId !== authorId) throw new Error("You can only react to your own articles.");

  const newValue = log.userResponse === response ? null : response;

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { userResponse: newValue },
  });

  return newValue;
}

module.exports = {
  saveDraft,
  loadToEditor,
  softDeleteLog,
  restoreLog,
  getArticleLogs,
  getArticleLogById,
  setUserResponse,
};
