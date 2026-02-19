/**
 * Wraps an async route handler to automatically catch errors
 * and forward them to the global error handler.
 *
 * @param {Function} fn - Async Express route handler
 * @returns {Function}
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
