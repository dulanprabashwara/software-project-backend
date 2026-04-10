// scripts/triggerScraping.js
// ─────────────────────────────────────────────────────────────────────────────
// Manual scraping trigger — runs the full scraping session right now,
// without waiting for Saturday and without needing the HTTP server running.
//
// HOW TO RUN (from project root):
//   node scripts/triggerScraping.js
//
// WHAT IT DOES:
//   Runs the exact same runScrapingSession() that the Saturday cron job calls.
//   Full Phase 1 (init) → Phase 2 (scrape) → Phase 3 (enrich + email report).
//   Results are saved to the database exactly as they would be on Saturday.
//
// WHEN TO USE THIS:
//   - You just added new URLs in the admin panel and want to test scraping now
//   - You want to verify the scraping mechanism works before Saturday
//   - A Saturday session failed and you want to re-run it manually
//   - Development and debugging
//
// REQUIREMENTS:
//   - Your .env file must be present and have DATABASE_URL and OPENROUTER_API_KEY
//   - Your database must be reachable (NeonDB connection)
//   - Run from the project root directory (where package.json is)
// ─────────────────────────────────────────────────────────────────────────────

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
