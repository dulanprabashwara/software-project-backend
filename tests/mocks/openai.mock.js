// tests/aitests/mocks/openai.mock.js
// ─────────────────────────────────────────────────────────────────────────────
// Replaces the real `openai` npm package.
//
// ai.service.js instantiates the client at module load time:
//   const client = new OpenAI({ baseURL: ..., apiKey: ... })
// Then calls:
//   client.chat.completions.create({ model, messages })
//
// This mock intercepts that constructor call and returns a stub client whose
// `chat.completions.create` is `mockChatCreate` — a plain jest.fn() that
// individual tests can configure with .mockResolvedValue() / .mockRejectedValue().
//
// The mock also exposes `mockChatCreate` so test files can import it directly:
//   const { mockChatCreate } = require("./mocks/openai.mock");
// ─────────────────────────────────────────────────────────────────────────────

const mockChatCreate = jest.fn();

const OpenAI = jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: mockChatCreate,
    },
  },
}));

module.exports = { OpenAI, mockChatCreate };
