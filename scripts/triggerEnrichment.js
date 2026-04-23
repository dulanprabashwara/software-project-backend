// scripts/triggerEnrichment.js
// Manually enriches articles that are missing their AI summary and keywords.
//
// HOW TO RUN (from project root):
//   node scripts/triggerEnrichment.js
//   node scripts/triggerEnrichment.js --session=<sessionId>
//   node scripts/triggerEnrichment.js --category="Finance & Money"
//   node scripts/triggerEnrichment.js --session=<sessionId> --category="Health & Medicine"

require("dotenv").config();

const { runManualEnrichment } = require("../src/services/enrichment.service");

function parseArgs() {
  const args   = process.argv.slice(2);
  const result = { sessionId: null, category: null };

  for (const arg of args) {
    if (arg.startsWith("--session="))  result.sessionId = arg.replace("--session=", "").trim();
    if (arg.startsWith("--category=")) result.category  = arg.replace("--category=", "").trim();
  }

  return result;
}

const { sessionId, category } = parseArgs();

console.log("═".repeat(60));
console.log("  Manual Enrichment Trigger");
console.log(`  Started: ${new Date().toISOString()}`);
if (sessionId) console.log(`  Session: ${sessionId}`);
if (category)  console.log(`  Category: ${category}`);
if (!sessionId && !category) console.log("  Scope: ALL unenriched articles");
console.log("═".repeat(60));
console.log("");

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