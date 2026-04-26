// tests/aitests/mocks/prisma.mock.ai.js
// ─────────────────────────────────────────────────────────────────────────────
// Replaces the real Prisma client (src/config/prisma.js) for all AI tests.
// Every method is a jest.fn() so individual tests can call .mockResolvedValue()
// or .mockRejectedValue() to control behaviour without touching the database.
//
// Usage in test files:
//   jest.mock("../../src/config/prisma", () => require("./mocks/prisma.mock.ai"));
// ─────────────────────────────────────────────────────────────────────────────

const prismaMock = {
  ai_article_logs: {
    create:     jest.fn(),
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    update:     jest.fn(),
    deleteMany: jest.fn(),
  },

  scrapedArticle: {
    findMany: jest.fn(),
  },

  article: {
    create:     jest.fn(),
    findUnique: jest.fn(),
    update:     jest.fn(),
    findMany:   jest.fn(),
  },
};

module.exports = prismaMock;
