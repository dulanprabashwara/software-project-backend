// tests/mocks/prisma.mock.search.js
// Provides a fully-typed jest mock for the Prisma client.
// Import this in any search test with:
//   jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock.search"));

const prismaMock = {
  article: {
    findMany: jest.fn(),
    count:    jest.fn(),
  },
  user: {
    findMany:   jest.fn(),
    count:      jest.fn(),
    findUnique: jest.fn(),
  },
  savedArticle: {
    findMany: jest.fn(),
  },
  follow: {
    findMany: jest.fn(),
  },
  // $queryRaw is used by fetchTagMatchIds and countTagOnly for tag-based searches.
  // Returning [] by default means no tag matches — a safe neutral value for tests
  // that are not specifically testing tag-match behaviour.
  $queryRaw:        jest.fn().mockResolvedValue([]),
  $queryRawUnsafe:  jest.fn().mockResolvedValue([]),
};

// Resets all mocks between tests and restores safe default return values
// for $queryRaw so tests that don't care about tag matching don't crash.
prismaMock.__resetAll = () => {
  Object.values(prismaMock).forEach((model) => {
    if (model && typeof model === "object") {
      Object.values(model).forEach((fn) => {
        if (typeof fn === "function" && fn.mockReset) fn.mockReset();
      });
    }
  });
  // Re-apply defaults after reset clears them.
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$queryRawUnsafe.mockResolvedValue([]);
};

module.exports = prismaMock;
