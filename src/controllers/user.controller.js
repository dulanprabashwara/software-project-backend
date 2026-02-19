const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const userService = require("../services/user.service");
const { parsePagination } = require("../utils/helpers");

/**
 * GET /api/v1/users/:identifier
 * Get a user profile by ID or username.
 */
const getProfile = asyncHandler(async (req, res) => {
  const { identifier } = req.params;
  const currentUserId = req.user?.id || null;

  const profile = await userService.getUserProfile(identifier, currentUserId);

  sendSuccess(res, {
    message: "User profile retrieved.",
    data: profile,
  });
});

/**
 * PUT /api/v1/users/profile
 * Update current user's profile.
 */
const updateProfile = asyncHandler(async (req, res) => {
  const user = await userService.updateProfile(req.user.id, req.body);

  sendSuccess(res, {
    message: "Profile updated successfully.",
    data: user,
  });
});

/**
 * GET /api/v1/users/search?q=query
 * Search users by username or display name.
 */
const searchUsers = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: "Search query must be at least 2 characters.",
    });
  }

  const { page, limit } = parsePagination(req.query);
  const { users, total } = await userService.searchUsers(q.trim(), page, limit);

  sendPaginated(res, {
    data: users,
    page,
    limit,
    total,
    message: "Users found.",
  });
});

module.exports = { getProfile, updateProfile, searchUsers };
