// scripts/triggerScraping.js
// Manually runs a full scraping session right now (same as the Saturday cron job).
// Useful for testing new sources, re-running a failed session, or development.
//
// HOW TO RUN (from project root):
//   node scripts/triggerScraping.js
//
// REQUIREMENTS: .env with DATABASE_URL and OPENROUTER_API_KEY, reachable NeonDB.

require("dotenv").config();

const { runScrapingSession } = require("../src/services/scraper.service");

console.log("═".repeat(60));
console.log("  Manual Scraping Trigger");
console.log(`  Started: ${new Date().toISOString()}`);
console.log("═".repeat(60));
console.log("");

runScrapingSession()
  .then((result) => {
    console.log("\n✅ Scraping session completed successfully.");
    if (result?.sessionId) {
      console.log(`   Session ID: ${result.sessionId}`);
      console.log(`   View logs: GET /api/scraper/sessions/${result.sessionId}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Scraping session failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
