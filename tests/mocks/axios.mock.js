// tests/mocks/axios.mock.js
// ─────────────────────────────────────────────────────────────────────────────
// Manual mock for the `axios` module.
// Replaces every axios method used by wordpress.service.js with a jest.fn().
//
// Usage:
//   jest.mock("axios", () => require("../mocks/axios.mock"));
//   const axios = require("axios");
//   axios.post.mockResolvedValue({ data: { access_token: "tok", blog_id: 1 } });
// ─────────────────────────────────────────────────────────────────────────────

const axios = {
  get:    jest.fn(),
  post:   jest.fn(),
  put:    jest.fn(),
  delete: jest.fn(),
  patch:  jest.fn(),
};

module.exports = axios;
