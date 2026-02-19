const slugify = require("slugify");
const prisma = require("../config/prisma");

/**
 * Generate a unique slug for an article.
 * If the slug already exists, appends a random suffix.
 *
 * @param {string} title
 * @returns {Promise<string>}
 */
const generateUniqueSlug = async (title) => {
  let slug = slugify(title, { lower: true, strict: true, trim: true });

  // Check for existing slug
  const existing = await prisma.article.findUnique({ where: { slug } });

  if (existing) {
    const suffix = Math.random().toString(36).substring(2, 8);
    slug = `${slug}-${suffix}`;
  }

  return slug;
};

/**
 * Calculate estimated reading time from content.
 * Assumes average 200 words per minute.
 *
 * @param {string} content - Article content (HTML or Markdown)
 * @returns {number} Reading time in minutes (minimum 1)
 */
const calculateReadingTime = (content) => {
  if (!content) return 1;
  // Strip HTML tags for word count
  const plainText = content.replace(/<[^>]*>/g, "");
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
};

/**
 * Parse pagination params from query string.
 *
 * @param {object} query - Express req.query
 * @returns {{ page: number, limit: number, skip: number }}
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

module.exports = { generateUniqueSlug, calculateReadingTime, parsePagination };
