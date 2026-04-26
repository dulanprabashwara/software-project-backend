// tests/mocks/prisma.mock.auth.js
// ─────────────────────────────────────────────────────────────────────────────
// A Prisma mock focused on models used by auth.service.js and auth.js middleware.
// Extends the base prisma mock with the `user` model methods needed by auth.
// ─────────────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique:  jest.fn(),
    findFirst:   jest.fn(),
    create:      jest.fn(),
    update:      jest.fn(),
  },
};

module.exports = mockPrisma;
