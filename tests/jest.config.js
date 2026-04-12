// tests/jest.config.js
// ─────────────────────────────────────────────────────────────────────────────
// jest.config.js lives INSIDE the tests/ folder.
// So <rootDir> = the tests/ folder itself.
// All paths here are relative to tests/, not the project root.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  testEnvironment: "node",

  // <rootDir> = tests/ folder (where this config file lives)
  // So tests inside tests/ are found with just "**/*.test.js"
  roots: ["<rootDir>"],

  // Find all .test.js files in any subfolder inside tests/
  testMatch: [
    "**/*.test.js",
    "**/*.spec.js",
  ],

  // Never run anything in node_modules
  testPathIgnorePatterns: ["/node_modules/"],

  verbose: true,
  testTimeout: 10000,

  // setup.js is at tests/setup.js
  // Since rootDir = tests/, this path is just <rootDir>/setup.js
  setupFiles: ["<rootDir>/setup.js"],

  // Coverage — paths relative to the PROJECT root (one level up from tests/)
  collectCoverageFrom: [
    "../src/services/scraper.service.js",
    "../src/services/enrichment.service.js",
    "../src/services/email.service.js",
    "../src/config/categoryKeywords.js",
  ],

  coverageReporters: ["text", "lcov"],
  coverageDirectory: "../coverage",
  bail: false,
};
