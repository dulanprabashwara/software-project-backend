// tests/mocks/prisma.mock.js
// Fake Prisma client — replaces every DB method with a jest spy for testing.
// Usage: jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

const mockPrisma = {
  scrapingSource: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  scrapingSession: {
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  scrapingLog: {
    create:   jest.fn(),
    findMany: jest.fn(),
  },
  scrapedArticle: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
  categoryScrapingStats: {
    create:   jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

module.exports = mockPrisma;
