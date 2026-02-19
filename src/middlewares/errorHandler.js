/**
 * Global error handler middleware.
 * Catches all errors thrown in route handlers and services.
 */

const errorHandler = (err, req, res, _next) => {
  console.error("─── Error ───");
  console.error("Message:", err.message);
  console.error("Stack:", err.stack);

  // Prisma known errors
  if (err.code === "P2002") {
    const target = err.meta?.target;
    return res.status(409).json({
      success: false,
      message: `A record with this ${target ? target.join(", ") : "value"} already exists.`,
    });
  }

  if (err.code === "P2025") {
    return res.status(404).json({
      success: false,
      message: "Record not found.",
    });
  }

  // Validation errors
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: err.message,
      errors: err.errors,
    });
  }

  // Firebase auth errors
  if (err.code && err.code.startsWith("auth/")) {
    return res.status(401).json({
      success: false,
      message: err.message,
    });
  }

  // Default server error
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error."
        : err.message,
  });
};

module.exports = errorHandler;
