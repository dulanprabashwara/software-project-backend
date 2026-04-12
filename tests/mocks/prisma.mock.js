// tests/mocks/prisma.mock.js
// ─────────────────────────────────────────────────────────────────────────────
// A fake Prisma client that records calls without touching the real database.
//
// Why needed:
//   Tests run without a real database. Any function that calls prisma.xxx()
//   would crash with a connection error. This mock replaces every prisma method
//   with a jest.fn() — a spy that records how it was called and returns
//   whatever you tell it to (using .mockResolvedValue()).
//
// How to use in a test file:
//   jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));
//   const prisma = require("../../src/config/prisma");
//   prisma.scrapedArticle.create.mockResolvedValue({ id: "abc123", ... });
// ─────────────────────────────────────────────────────────────────────────────

const mockPrisma = {
  scrapingSource: {
    findMany:  jest.fn(),
    findUnique: jest.fn(),
    create:    jest.fn(),
    update:    jest.fn(),
    delete:    jest.fn(),
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
  keywordScrapingStats: {
    create:   jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
};

module.exports = mockPrisma;
