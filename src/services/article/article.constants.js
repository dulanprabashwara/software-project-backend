/* src/services/article/article.constants.js */

/*
 Article Status Enum
 */
const ARTICLE_STATUS = Object.freeze({
  EDITING: "EDITING",
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  SCHEDULED: "SCHEDULED",
});

const MAX_TAGS = 5;

/*
 Shared author selection for Prisma queries
 */
const BASIC_AUTHOR_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
};

/*
 Standard include for article author
 */
const ARTICLE_AUTHOR_INCLUDE = {
  author: {
    select: BASIC_AUTHOR_SELECT,
  },
};

module.exports = {
  ARTICLE_STATUS,
  MAX_TAGS,
  BASIC_AUTHOR_SELECT,
  ARTICLE_AUTHOR_INCLUDE,
};
