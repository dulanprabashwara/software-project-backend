// tests/mocks/prisma.mock.wp.js
// ─────────────────────────────────────────────────────────────────────────────
// Prisma mock for WordPress integration tests.
// Kept SEPARATE from prisma.mock.js so scraper tests are completely unaffected.
//
// Covers every Prisma model touched by:
//   src/services/wordpress.service.js
//   src/jobs/wordpress.job.js
//
// Usage in a WordPress test file:
//   jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock.wp"));
//   const prisma = require("../../src/config/prisma");
//   prisma.wordPressConnection.findUnique.mockResolvedValue({ ... });
// ─────────────────────────────────────────────────────────────────────────────

const mockPrismaWp = {
  wordPressConnection: {
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    upsert:     jest.fn(),
    delete:     jest.fn(),
  },
  wordPressPublishJob: {
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  article: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update:     jest.fn(),
  },
};

module.exports = mockPrismaWp;
