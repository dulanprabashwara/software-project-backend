/**
 * Standard API response helpers.
 */

/**
 * Send a success response.
 *
 * @param {import("express").Response} res
 * @param {object} options
 * @param {number} [options.statusCode=200]
 * @param {string} [options.message="Success"]
 * @param {*} [options.data=null]
 * @param {object} [options.meta=null] - Pagination or extra metadata
 */
const sendSuccess = (
  res,
  { statusCode = 200, message = "Success", data = null, meta = null } = {},
) => {
  const response = { success: true, message };
  if (data !== null) response.data = data;
  if (meta !== null) response.meta = meta;
  return res.status(statusCode).json(response);
};

/**
 * Send a paginated success response.
 *
 * @param {import("express").Response} res
 * @param {object} options
 * @param {*} options.data
 * @param {number} options.page
 * @param {number} options.limit
 * @param {number} options.total
 * @param {string} [options.message="Success"]
 */
const sendPaginated = (
  res,
  { data, page, limit, total, message = "Success" },
) => {
  return sendSuccess(res, {
    message,
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
};

module.exports = { sendSuccess, sendPaginated };
