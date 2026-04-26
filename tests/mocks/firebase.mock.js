// tests/mocks/firebase.mock.js
// ─────────────────────────────────────────────────────────────────────────────
// A fake Firebase Admin SDK so tests never touch real Firebase servers.
//
// Why needed:
//   `src/config/firebase.js` calls admin.initializeApp() which requires
//   real Firebase credentials. This mock skips that entirely and replaces
//   every method used by auth.js and auth.service.js with jest.fn() spies.
//
// How to use in a test file:
//   jest.mock("../../src/config/firebase", () => require("../mocks/firebase.mock"));
//   const admin = require("../../src/config/firebase");
//   admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-123" });
// ─────────────────────────────────────────────────────────────────────────────

const mockAuth = {
  verifyIdToken: jest.fn(),
  getUser:       jest.fn(),
};

// firebase.auth() returns the mockAuth object above
const mockAdmin = {
  auth: jest.fn(() => mockAuth),
};

module.exports = mockAdmin;
