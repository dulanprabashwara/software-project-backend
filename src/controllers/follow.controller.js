const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const followService = require("../services/follow.service");
const { parsePagination } = require("../utils/helpers");

/**
 * POST /api/v1/users/:userId/follow
 * Toggle follow/unfollow a user.
 */
const toggleFollow = asyncHandler(async (req, res) => {
  const result = await followService.toggleFollow(
    req.user.id,
    req.params.userId,
  );

  sendSuccess(res, {
    message: result.followed
      ? "Followed successfully."
      : "Unfollowed successfully.",
    data: result,
  });
});

/**
 * GET /api/v1/users/:userId/followers
 * Get a user's followers.
 */
const getFollowers = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { users, total } = await followService.getFollowers(
    req.params.userId,
    page,
    limit,
  );

  sendPaginated(res, {
    data: users,
    page,
    limit,
    total,
    message: "Followers retrieved.",
  });
});

/**
 * GET /api/v1/users/:userId/following
 * Get users that a user is following.
 */
const getFollowing = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { users, total } = await followService.getFollowing(
    req.params.userId,
    page,
    limit,
  );

  sendPaginated(res, {
    data: users,
    page,
    limit,
    total,
    message: "Following retrieved.",
  });
});

/**
 * GET /api/v1/feed/following
 * Get articles from users the current user follows.
 */
const getFollowingFeed = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { articles, total } = await followService.getFollowingFeed(
    req.user.id,
    page,
    limit,
  );

  sendPaginated(res, {
    data: articles,
    page,
    limit,
    total,
    message: "Following feed.",
  });
});

module.exports = { toggleFollow, getFollowers, getFollowing, getFollowingFeed };
