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
    findMany: jest.fn(),
    count:    jest.fn(),
    findUnique: jest.fn(),
  },
  savedArticle: {
    findMany: jest.fn(),
  },
  follow: {
    findMany: jest.fn(),
  },
};

// Helper: reset all mocks between tests
prismaMock.__resetAll = () => {
  Object.values(prismaMock).forEach((model) => {
    if (model && typeof model === "object") {
      Object.values(model).forEach((fn) => {
        if (typeof fn === "function" && fn.mockReset) fn.mockReset();
      });
    }
  });
};

module.exports = prismaMock;
