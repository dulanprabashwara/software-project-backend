// tests/wordpress/fixtures.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared test data used across all WordPress test files.
// Import what you need: const { MOCK_USER, MOCK_ARTICLE, ... } = require("./fixtures");
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id:                 "user_abc123",
  email:              "emma@example.com",
  username:           "emma_richardson",
  displayName:        "Emma Richardson",
  avatarUrl:          "https://cdn.easyblogger.com/avatars/emma.jpg",
  wordpressAccountId: null,
  role:               "USER",
  isPremium:          true,
};

const MOCK_ARTICLE = {
  id:          "article_xyz789",
  title:       "Getting Started with TypeScript",
  slug:        "getting-started-with-typescript",
  content:     "<h1>Getting Started</h1><p>TypeScript is a typed superset of JavaScript.</p><img src=\"https://cdn.easyblogger.com/images/ts-logo.png\" alt=\"TypeScript\" />",
  summary:     "A beginner guide to TypeScript.",
  coverImage:  "https://cdn.easyblogger.com/covers/typescript.jpg",
  tags:        ["TypeScript", "JavaScript", "Web Development"],
  status:      "PUBLISHED",
  authorId:    "user_abc123",
  slug:        "getting-started-with-typescript",
  readingTime: 5,
  publishedAt: new Date("2025-12-01T10:00:00Z"),
  createdAt:   new Date("2025-11-30T08:00:00Z"),
  updatedAt:   new Date("2025-11-30T08:00:00Z"),
};

const MOCK_ARTICLE_NO_EXTRAS = {
  ...MOCK_ARTICLE,
  id:         "article_minimal001",
  coverImage: null,
  tags:       [],
};

const MOCK_WP_CONNECTION = {
  id:          "conn_wp001",
  userId:      "user_abc123",
  siteUrl:     "https://emmablog.wordpress.com",
  siteId:      "123456789",
  accessToken: "wp_oauth_token_secret_abc",
  wpUsername:  "Emma Richardson",
  wpEmail:     "emma@wordpress.com",
  connectedAt: new Date("2025-10-01T09:00:00Z"),
  updatedAt:   new Date("2025-10-01T09:00:00Z"),
};

// The public-facing version (accessToken omitted, as the service selects it)
const MOCK_WP_CONNECTION_PUBLIC = {
  id:          "conn_wp001",
  userId:      "user_abc123",
  siteUrl:     "https://emmablog.wordpress.com",
  siteId:      "123456789",
  wpUsername:  "Emma Richardson",
  wpEmail:     "emma@wordpress.com",
  connectedAt: new Date("2025-10-01T09:00:00Z"),
};

const MOCK_WP_TOKEN_RESPONSE = {
  access_token: "wp_oauth_token_secret_abc",
  blog_id:      123456789,
  blog_url:     "https://emmablog.wordpress.com",
  token_type:   "bearer",
};

const MOCK_WP_ME_RESPONSE = {
  ID:           98765,
  display_name: "Emma Richardson",
  username:     "emma_wp",
  email:        "emma@wordpress.com",
  avatar_URL:   "https://secure.gravatar.com/avatar/abc123",
};

const MOCK_WP_POST_RESPONSE = {
  ID:     555000,
  URL:    "https://emmablog.wordpress.com/2025/12/01/getting-started-with-typescript/",
  title:  "Getting Started with TypeScript",
  status: "publish",
};

const MOCK_PUBLISH_JOB_PENDING = {
  id:          "job_001",
  articleId:   "article_xyz789",
  userId:      "user_abc123",
  wpConnId:    "conn_wp001",
  scheduledAt: new Date(Date.now() - 60000), // 1 minute ago
  status:      "PENDING",
  wpPostId:    null,
  wpPostUrl:   null,
  draftUrl:    null,
  errorMsg:    null,
  createdAt:   new Date(Date.now() - 120000),
  updatedAt:   new Date(Date.now() - 120000),
};

const MOCK_PUBLISH_JOB_PUBLISHED = {
  ...MOCK_PUBLISH_JOB_PENDING,
  id:        "job_002",
  status:    "PUBLISHED",
  wpPostId:  "555000",
  wpPostUrl: "https://emmablog.wordpress.com/2025/12/01/getting-started-with-typescript/",
};

const MOCK_PUBLISH_JOB_FAILED = {
  ...MOCK_PUBLISH_JOB_PENDING,
  id:       "job_003",
  status:   "FAILED",
  errorMsg: "WordPress API returned 403 Forbidden",
  draftUrl: "https://wordpress.com/posts/emmablog.wordpress.com",
};

const VALID_OAUTH_STATE = Buffer.from(
  JSON.stringify({ userId: "user_abc123" })
).toString("base64url");

const INVALID_OAUTH_STATE = "not_valid_base64_at_all!!!";

module.exports = {
  MOCK_USER,
  MOCK_ARTICLE,
  MOCK_ARTICLE_NO_EXTRAS,
  MOCK_WP_CONNECTION,
  MOCK_WP_CONNECTION_PUBLIC,
  MOCK_WP_TOKEN_RESPONSE,
  MOCK_WP_ME_RESPONSE,
  MOCK_WP_POST_RESPONSE,
  MOCK_PUBLISH_JOB_PENDING,
  MOCK_PUBLISH_JOB_PUBLISHED,
  MOCK_PUBLISH_JOB_FAILED,
  VALID_OAUTH_STATE,
  INVALID_OAUTH_STATE,
};
