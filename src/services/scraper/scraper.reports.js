// @ts-nocheck
// src/services/scraper/scraper.reports.js
// Helpers for the main orchestrator: critical error detection and session report builders.

const {
  CRITICAL_SUCCESS_RATE_THRESHOLD,
  CRITICAL_FAILED_CATEGORIES_THRESHOLD,
} = require("./scraper.constants");

// ════════════════════════════════════════════════════════════════════════════
// HELPERS FOR THE MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════════════

// Checks session results for critical issues (very low success rate, multiple empty categories).
function checkCriticalErrors(report, counters) {
  const issues = [];

  if (report.successRate < CRITICAL_SUCCESS_RATE_THRESHOLD && report.totalSources > 0) {
    issues.push(`Success rate critically low: ${report.successRate}% (threshold: ${CRITICAL_SUCCESS_RATE_THRESHOLD}%)`);
  }

  const totalFailedCategories = Object.entries(counters)
    .filter(([, c]) => c.successCount === 0 && c.failureCount > 0).length;
  if (totalFailedCategories >= CRITICAL_FAILED_CATEGORIES_THRESHOLD) {
    issues.push(`${totalFailedCategories} categories produced zero articles`);
  }

  return issues;
}

// Builds a partial session report from current counters for use when a session is interrupted mid-run.
function buildPartialReport(sessionId, startTime, config, counters) {
  const totalSuccess    = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
  const totalDuplicate  = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
  const totalFailure    = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
  const totalUrlsFound  = Object.values(counters).reduce((s, c) => s + c.urlsProcessed,  0);
  const durationMinutes = (Date.now() - startTime) / 60000;
  const attempted       = totalSuccess + totalFailure;

  return {
    sessionId,
    startedAt:              new Date(startTime).toISOString(),
    completedAt:            new Date().toISOString(),
    durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
    totalSources:           config?.totalSources || 0,
    totalUrlsFound,
    successCount:           totalSuccess,
    duplicateCount:         totalDuplicate,
    failureCount:           totalFailure,
    successRate:            attempted > 0 ? parseFloat(((totalSuccess / attempted) * 100).toFixed(2)) : null,
    enrichedCount:          0,
    enrichmentFailed:       0,
    keywordsWithContent:    [],
    keywordsWithoutContent: [],
    totalKeywordsCovered:   0,
    totalKeywordsEmpty:     0,
    aiTokenUsage:           { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
    criticalErrors:         true,
    isInterrupted:          true,
  };
}

// Builds a crash report when the session fails due to an unhandled error (DB down, code error, etc.).
function buildCrashReport(sessionId, startTime, config, counters, errorMessage) {
  const totalSuccess    = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
  const totalDuplicate  = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
  const totalFailure    = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
  const totalUrlsFound  = Object.values(counters).reduce((s, c) => s + c.urlsProcessed,  0);
  const durationMinutes = (Date.now() - startTime) / 60000;
  const attempted       = totalSuccess + totalFailure;

  return {
    sessionId,
    startedAt:              new Date(startTime).toISOString(),
    completedAt:            new Date().toISOString(),
    durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
    totalSources:           config?.totalSources || 0,
    totalUrlsFound,
    successCount:           totalSuccess,
    duplicateCount:         totalDuplicate,
    failureCount:           totalFailure,
    successRate:            attempted > 0 ? parseFloat(((totalSuccess / attempted) * 100).toFixed(2)) : null,
    enrichedCount:          0,
    enrichmentFailed:       0,
    keywordsWithContent:    [],
    keywordsWithoutContent: [],
    totalKeywordsCovered:   0,
    totalKeywordsEmpty:     0,
    aiTokenUsage:           { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
    criticalErrors:         true,
    isCrashed:              true,
    crashReason:            errorMessage,
  };
}

module.exports = {
  checkCriticalErrors,
  buildPartialReport,
  buildCrashReport,
};
