const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const commentService = require("../services/comment.service");
const { parsePagination } = require("../utils/helpers");

/**
 * POST /api/v1/articles/:articleId/comments
 * Add a comment to an article.
 */
const addComment = asyncHandler(async (req, res) => {
  const { content, parentId } = req.body;
  const comment = await commentService.addComment(
    req.params.articleId,
    req.user.id,
    content,
    parentId,
  );

  sendSuccess(res, {
    statusCode: 201,
    message: "Comment added.",
    data: comment,
  });
});

/**
 * GET /api/v1/articles/:articleId/comments
 * Get comments for an article.
 */
const getComments = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { comments, total } = await commentService.getArticleComments(
    req.params.articleId,
    page,
    limit,
  );

  sendPaginated(res, { data: comments, page, limit, total });
});

/**
 * PUT /api/v1/comments/:id
 * Update a comment.
 */
const updateComment = asyncHandler(async (req, res) => {
  const comment = await commentService.updateComment(
    req.params.id,
    req.user.id,
    req.body.content,
  );

  sendSuccess(res, { message: "Comment updated.", data: comment });
});

/**
 * DELETE /api/v1/comments/:id
 * Delete a comment.
 */
const deleteComment = asyncHandler(async (req, res) => {
  await commentService.deleteComment(req.params.id, req.user.id, req.user.role);

  sendSuccess(res, { message: "Comment deleted." });
});

module.exports = { addComment, getComments, updateComment, deleteComment };
