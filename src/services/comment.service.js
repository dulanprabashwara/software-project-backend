const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

/**
 * Add a comment to an article.
 */
const addComment = async (articleId, authorId, content, parentId = null) => {
  if (!content?.trim()) {
    throw ApiError.badRequest("Comment content is required.");
  }

  // Verify article exists
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");

  // If replying, verify parent comment exists
  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
    });
    if (!parentComment) throw ApiError.notFound("Parent comment not found.");
    if (parentComment.articleId !== articleId) {
      throw ApiError.badRequest(
        "Parent comment does not belong to this article.",
      );
    }
  }

  const comment = await prisma.comment.create({
    data: {
      content: content.trim(),
      authorId,
      articleId,
      parentId,
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

  // Update article comment count
  await prisma.article.update({
    where: { id: articleId },
    data: { commentCount: { increment: 1 } },
  });

  return comment;
};

/**
 * Get comments for an article (paginated, top-level only with nested replies).
 */
const getArticleComments = async (articleId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where: { articleId, parentId: null },
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
        _count: { select: { replies: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.comment.count({ where: { articleId, parentId: null } }),
  ]);

  return { comments, total };
};

/**
 * Update a comment (only by author).
 */
const updateComment = async (commentId, userId, content) => {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });

  if (!comment) throw ApiError.notFound("Comment not found.");
  if (comment.authorId !== userId)
    throw ApiError.forbidden("You can only edit your own comments.");

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { content: content.trim() },
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
 * Delete a comment (by author or admin).
 */
const deleteComment = async (commentId, userId, userRole) => {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });

  if (!comment) throw ApiError.notFound("Comment not found.");
  if (comment.authorId !== userId && userRole !== "ADMIN") {
    throw ApiError.forbidden("You can only delete your own comments.");
  }

  // Count replies that will be cascade-deleted
  const replyCount = await prisma.comment.count({
    where: { parentId: commentId },
  });

  await prisma.comment.delete({ where: { id: commentId } });

  // Update article comment count (comment + its replies)
  await prisma.article.update({
    where: { id: comment.articleId },
    data: { commentCount: { decrement: 1 + replyCount } },
  });

  return { deleted: true };
};

module.exports = {
  addComment,
  getArticleComments,
  updateComment,
  deleteComment,
};
