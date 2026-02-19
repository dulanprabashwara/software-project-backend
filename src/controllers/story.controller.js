const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const storyService = require("../services/story.service");

/**
 * POST /api/v1/stories
 * Create a new story.
 */
const createStory = asyncHandler(async (req, res) => {
  const story = await storyService.createStory(req.user.id, req.body);

  sendSuccess(res, {
    statusCode: 201,
    message: "Story created.",
    data: story,
  });
});

/**
 * GET /api/v1/stories
 * Get stories from following + own stories.
 */
const getStories = asyncHandler(async (req, res) => {
  const stories = await storyService.getFollowingStories(req.user.id);

  sendSuccess(res, {
    message: "Stories retrieved.",
    data: stories,
  });
});

/**
 * DELETE /api/v1/stories/:id
 * Delete a story.
 */
const deleteStory = asyncHandler(async (req, res) => {
  await storyService.deleteStory(req.params.id, req.user.id);

  sendSuccess(res, { message: "Story deleted." });
});

module.exports = { createStory, getStories, deleteStory };
