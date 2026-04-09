// scripts/triggerEnrichment.js
// ─────────────────────────────────────────────────────────────────────────────
// Manual enrichment trigger — runs AI summarization and keyword tagging on
// any scraped articles that are missing their summary/keywords.
//
// USE THIS WHEN:
//   - A scraping session completed but enrichment failed (e.g. AI model error)
//   - Articles were scraped but show summary=null in the database
//   - You want to re-run enrichment for a specific session or category
//
// HOW TO RUN (from project root):
//
//   Enrich ALL unenriched articles across all sessions:
//     node scripts/triggerEnrichment.js
//
//   Enrich unenriched articles from a specific session only:
//     node scripts/triggerEnrichment.js --session=<sessionId>
//
//   Enrich unenriched articles in a specific category only:
//     node scripts/triggerEnrichment.js --category="Technology & Digital Life"
//
//   Combine both filters:
//     node scripts/triggerEnrichment.js --session=<sessionId> --category="Health & Medicine"
//
// EXAMPLES:
//   node scripts/triggerEnrichment.js
//   node scripts/triggerEnrichment.js --session=cmnqitcx0000vg903927q2...
//   node scripts/triggerEnrichment.js --category="Finance & Money"
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();

const { runManualEnrichment } = require("../src/services/enrichment.service");

// ── Parse command line arguments ──────────────────────────────────────────────
// Supports --session=VALUE and --category=VALUE flags

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { sessionId: null, category: null };

  for (const arg of args) {
    if (arg.startsWith("--session=")) {
      result.sessionId = arg.replace("--session=", "").trim();
    } else if (arg.startsWith("--category=")) {
      result.category = arg.replace("--category=", "").trim();
    }
  }

  return result;
}

const { sessionId, category } = parseArgs();

// ── Display what will be processed ───────────────────────────────────────────

console.log("═".repeat(60));
console.log("  Manual Enrichment Trigger");
console.log(`  Started: ${new Date().toISOString()}`);
if (sessionId) console.log(`  Session: ${sessionId}`);
if (category)  console.log(`  Category: ${category}`);
if (!sessionId && !category) console.log("  Scope: ALL unenriched articles");
console.log("═".repeat(60));
console.log("");

// ── Run enrichment ────────────────────────────────────────────────────────────

runManualEnrichment({ sessionId, category })
  .then((result) => {
    console.log("\n" + "═".repeat(60));
    console.log("✅ Manual enrichment completed successfully.");
    console.log(`   Articles found:    ${result.totalFound}`);
    console.log(`   Articles enriched: ${result.enrichedCount}`);
    console.log(`   Failed:            ${result.enrichmentFailed}`);
    console.log(`   Keywords covered:  ${result.keywordsWithContent.length}`);
    console.log(`   Tokens used:       Input ${result.tokenUsage.inputTokens} | Output ${result.tokenUsage.outputTokens}`);

    if (result.keywordsWithContent.length > 0) {
      console.log("\n   Top keywords covered:");
      result.keywordsWithContent.slice(0, 10).forEach((k) => {
        console.log(`     • ${k.keyword} (${k.articleCount} articles)`);
      });
    }

    console.log("═".repeat(60));
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Manual enrichment failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
