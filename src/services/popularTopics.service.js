const prisma = require("../config/prisma");

/**
 * Fetches the most used tags across all published articles.
 * @param {number} limit - How many tags to return.
 */
const getPopularTags = async (limit = 10) => {
  // We use $queryRaw because Prisma doesn't natively support 
  // grouping by individual elements inside a String[] array.
  const popularTags = await prisma.$queryRaw`
    SELECT LOWER(tag) as name, COUNT(*)::int as count
    FROM (
      SELECT unnest(tags) as tag
      FROM articles
      WHERE status = 'PUBLISHED'
    ) as flattened_tags
    GROUP BY LOWER(tag)
    ORDER BY count DESC
    LIMIT ${parseInt(limit)};
  `;

  return popularTags;
};

module.exports = {
  getPopularTags,
};