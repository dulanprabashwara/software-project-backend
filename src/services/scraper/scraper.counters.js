// @ts-nocheck
// src/services/scraper/scraper.counters.js
// Counter validation helpers — ensure all scraping and enrichment tallies are
// mathematically consistent before being written to the database.

// Validates that a category's counters are mathematically consistent before saving to the database.
// urlsProcessed must always equal the sum of all outcomes — any mismatch is a code bug, not user error.
function validateCounters(category, c) {
  const expectedTotal = c.successCount + c.duplicateCount + c.failureCount;

  if (c.urlsProcessed !== expectedTotal) {
    console.error(
      `[Phase 2] ⚠️  Counter mismatch in "${category}": ` +
      `urlsProcessed=${c.urlsProcessed} but success(${c.successCount}) + ` +
      `dupe(${c.duplicateCount}) + fail(${c.failureCount}) = ${expectedTotal}. ` +
      `Correcting urlsProcessed to ${expectedTotal}.`
    );
    c.urlsProcessed = expectedTotal;
  }

  if (c.successCount < 0 || c.duplicateCount < 0 || c.failureCount < 0 || c.urlsProcessed < 0) {
    console.error(`[Phase 2] ⚠️  Negative counter detected in "${category}" — resetting negatives to 0.`);
    c.successCount   = Math.max(0, c.successCount);
    c.duplicateCount = Math.max(0, c.duplicateCount);
    c.failureCount   = Math.max(0, c.failureCount);
    c.urlsProcessed  = c.successCount + c.duplicateCount + c.failureCount;
  }
}

// Validates that session-level URL totals are consistent before writing the final session record.
// totalUrlsFound must equal the sum of all three outcome buckets across all categories.
function validateSessionCounters(totalUrlsFound, totalSuccess, totalDuplicate, totalFailure) {
  const expectedTotal = totalSuccess + totalDuplicate + totalFailure;

  if (totalUrlsFound !== expectedTotal) {
    console.error(
      `[Phase 2] ⚠️  Session counter mismatch: ` +
      `totalUrlsFound=${totalUrlsFound} but success(${totalSuccess}) + ` +
      `dupe(${totalDuplicate}) + fail(${totalFailure}) = ${expectedTotal}. ` +
      `Correcting totalUrlsFound to ${expectedTotal}.`
    );
    return expectedTotal;
  }

  return totalUrlsFound;
}

// Validates that enrichment counts are consistent: every scraped article must be either enriched or failed.
// successCount is the number of scraped articles — all of them should have been attempted for enrichment.
function validateEnrichmentCounters(successCount, enrichedCount, enrichmentFailed) {
  const enrichmentTotal = enrichedCount + enrichmentFailed;

  if (enrichmentTotal > successCount) {
    console.error(
      `[Phase 3] ⚠️  Enrichment counter overflow: ` +
      `enriched(${enrichedCount}) + failed(${enrichmentFailed}) = ${enrichmentTotal} ` +
      `exceeds scraped article count (${successCount}). ` +
      `Capping enrichmentFailed to ${Math.max(0, successCount - enrichedCount)}.`
    );
    return Math.max(0, successCount - enrichedCount);
  }

  return enrichmentFailed;
}

// Validates that keyword coverage counts add up to the total number of keywords in the system.
// Every keyword is either covered (has at least one article) or empty — none can be unaccounted for.
function validateKeywordCounters(keywordsCoveredCount, keywordsEmptyCount, totalKeywordsInSystem) {
  const keywordTotal = keywordsCoveredCount + keywordsEmptyCount;

  if (totalKeywordsInSystem > 0 && keywordTotal !== totalKeywordsInSystem) {
    console.error(
      `[Phase 3] ⚠️  Keyword counter mismatch: ` +
      `covered(${keywordsCoveredCount}) + empty(${keywordsEmptyCount}) = ${keywordTotal} ` +
      `but total keywords in system = ${totalKeywordsInSystem}. ` +
      `This may indicate a categoryKeywords.js change mid-session.`
    );
  }

  if (keywordsCoveredCount < 0 || keywordsEmptyCount < 0) {
    console.error(`[Phase 3] ⚠️  Negative keyword counter detected — resetting negatives to 0.`);
    return {
      keywordsCoveredCount: Math.max(0, keywordsCoveredCount),
      keywordsEmptyCount:   Math.max(0, keywordsEmptyCount),
    };
  }

  return { keywordsCoveredCount, keywordsEmptyCount };
}

module.exports = {
  validateCounters,
  validateSessionCounters,
  validateEnrichmentCounters,
  validateKeywordCounters,
};
