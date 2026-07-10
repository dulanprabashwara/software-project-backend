//@ts-nocheck
// src/services/enrichment.service.js
// Phase 3a — AI enrichment: summarizes scraped articles and matches them to keywords.
// Uses OpenRouter API with multi-key and multi-model fallback to handle rate limits.

const prisma                = require("../config/prisma");
const { CATEGORY_KEYWORDS } = require("../config/categoryKeywords");

const { BATCH_SIZE, API_CALL_DELAY_MS } = require("./enrichment/enrichment.constants");
const { calculateEstimatedCost }         = require("./enrichment/enrichment.api");
const { processBatch }                   = require("./enrichment/enrichment.batch");
const { writeLog, buildKeywordCoverageReport } = require("./enrichment/enrichment.db");
const { CLIENTS }                        = require("./enrichment/enrichment.clients");

// ── runEnrichmentStage ────────────────────────────────────────────────────────
// Runs automatically as Phase 3 of every scraping session.
// Processes all unenriched articles from the session in category batches.
async function runEnrichmentStage(sessionId) {
  console.log(`\n[Enrichment] ═══ Enrichment Stage Starting ═══`);
  console.log(`[Enrichment] Session: ${sessionId}`);
  console.log(`[Enrichment] API keys available: ${CLIENTS.length}`);

  const logFn        = (logType, url, cat, reason, details) =>
    writeLog(sessionId, logType, url, cat, reason, details);
  const tokenTracker = { inputTokens: 0, outputTokens: 0, usedPaidModel: false };
  let totalEnriched  = 0;
  let totalFailed    = 0;

  for (const [category, categoryKeywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const articles = await prisma.scrapedArticle.findMany({
      where:  { sessionId, category, summary: null },
      select: { id: true, title: true, content: true, sourceUrl: true, category: true },
    });

    if (!articles.length) {
      console.log(`[Enrichment] "${category}" — no new articles`);
      continue;
    }

    console.log(`[Enrichment] "${category}" — ${articles.length} articles to enrich`);

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch    = articles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[Enrichment] "${category}" batch ${batchNum}: ${batch.length} articles`);

      if (i > 0) await new Promise((r) => setTimeout(r, API_CALL_DELAY_MS));

      const { enriched, failed } = await processBatch(
        batch, categoryKeywords, tokenTracker, sessionId, logFn
      );
      totalEnriched += enriched;
      totalFailed   += failed;
    }

    // Write partial enrichment progress to the session row after each category
    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        enrichedCount:         totalEnriched,
        enrichmentFailedCount: totalFailed,
        aiInputTokens:         tokenTracker.inputTokens,
        aiOutputTokens:        tokenTracker.outputTokens,
      },
    }).catch((e) =>
      console.error(`[Enrichment] Failed to write partial stats after "${category}": ${e.message}`)
    );
  }

  const { keywordsWithContent, keywordsWithoutContent } = await buildKeywordCoverageReport(sessionId);

  console.log(
    `[Enrichment] ═══ Complete: ✅${totalEnriched} enriched | ❌${totalFailed} failed\n` +
    `[Enrichment] Keywords covered: ${keywordsWithContent.length} | No content: ${keywordsWithoutContent.length}\n` +
    `[Enrichment] Tokens — Input: ${tokenTracker.inputTokens} | Output: ${tokenTracker.outputTokens}`
  );

  return {
    enrichedCount:          totalEnriched,
    enrichmentFailed:       totalFailed,
    keywordsWithContent,
    keywordsWithoutContent,
    tokenUsage: {
      inputTokens:      tokenTracker.inputTokens,
      outputTokens:     tokenTracker.outputTokens,
      estimatedCostUSD: calculateEstimatedCost(tokenTracker),
    },
  };
}

// ── runManualEnrichment ───────────────────────────────────────────────────────
// Enriches articles that were missed during automatic enrichment.
// Called by: scripts/triggerEnrichment.js, POST /api/scraper/enrich.
// Updates the original session records directly — no separate tracking table needed.
async function runManualEnrichment({
  sessionId = null,
  category  = null,
  sendEmail = true,
} = {}) {
  console.log("\n[Manual Enrichment] ═══ Starting ═══");
  if (sessionId) console.log(`[Manual Enrichment] Session filter: ${sessionId}`);
  if (category)  console.log(`[Manual Enrichment] Category filter: ${category}`);
  console.log(`[Manual Enrichment] API keys available: ${CLIENTS.length}`);

  // Ensure at least one session exists (needed to write logs)
  if (!sessionId) {
    const anySession = await prisma.scrapingSession.findFirst({
      orderBy: { startedAt: "desc" },
      select:  { id: true },
    });
    if (!anySession) {
      throw new Error("No scraping sessions exist. Run a scraping session first.");
    }
  }

  const tokenTracker = { inputTokens: 0, outputTokens: 0, usedPaidModel: false };
  let totalEnriched  = 0;
  let totalFailed    = 0;
  let totalFound     = 0;

  // Track enrichment results per session so we can update each session's stats
  const sessionTotals = new Map();

  const categoriesToProcess = category
    ? [category]
    : Object.keys(CATEGORY_KEYWORDS);

  for (const cat of categoriesToProcess) {
    const categoryKeywords = CATEGORY_KEYWORDS[cat];

    if (!categoryKeywords) {
      console.warn(`[Manual Enrichment] Unknown category "${cat}" — skipping`);
      continue;
    }

    const where = {
      category: cat,
      summary:  null,
      ...(sessionId && { sessionId }),
    };

    const articles = await prisma.scrapedArticle.findMany({
      where,
      select:  { id: true, title: true, content: true, sourceUrl: true, category: true, sessionId: true },
      orderBy: { scrapedAt: "desc" },
    });

    if (!articles.length) {
      console.log(`[Manual Enrichment] "${cat}" — no unenriched articles`);
      continue;
    }

    totalFound += articles.length;
    console.log(`[Manual Enrichment] "${cat}" — ${articles.length} unenriched articles`);

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch    = articles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[Manual Enrichment] "${cat}" batch ${batchNum}/${Math.ceil(articles.length / BATCH_SIZE)}`);

      if (i > 0) await new Promise((r) => setTimeout(r, API_CALL_DELAY_MS));

      // Log events against each article's own session
      const logSessionId = batch[0].sessionId;
      const logFn        = (logType, url, cat2, reason, details) =>
        writeLog(logSessionId, logType, url, cat2, reason, details);

      const tokensBefore         = { input: tokenTracker.inputTokens, output: tokenTracker.outputTokens };
      const { enriched, failed } = await processBatch(
        batch, categoryKeywords, tokenTracker, logSessionId, logFn
      );
      const tokensUsedInput  = tokenTracker.inputTokens  - tokensBefore.input;
      const tokensUsedOutput = tokenTracker.outputTokens - tokensBefore.output;

      // Group batch articles by their session and attribute results proportionally
      const batchSessionGroups = new Map();
      for (const article of batch) {
        batchSessionGroups.set(
          article.sessionId,
          (batchSessionGroups.get(article.sessionId) || 0) + 1
        );
      }

      for (const [sid, articleCount] of batchSessionGroups) {
        if (!sessionTotals.has(sid)) {
          sessionTotals.set(sid, { enriched: 0, failed: 0, inputTokens: 0, outputTokens: 0 });
        }
        const fraction = articleCount / batch.length;
        const st       = sessionTotals.get(sid);
        st.enriched     += Math.round(enriched * fraction);
        st.failed       += Math.round(failed   * fraction);
        st.inputTokens  += Math.round(tokensUsedInput  * fraction);
        st.outputTokens += Math.round(tokensUsedOutput * fraction);
      }

      totalEnriched += enriched;
      totalFailed   += failed;
    }
  }

  // Update each affected ScrapingSession with cumulative enrichment stats
  const updatedSessionIds = [];
  for (const [sid, totals] of sessionTotals) {
    try {
      const existing = await prisma.scrapingSession.findUnique({
        where:  { id: sid },
        select: {
          enrichedCount:  true,
          aiInputTokens:  true,
          aiOutputTokens: true,
        },
      });

      if (!existing) continue;

      const { keywordsWithContent, keywordsWithoutContent } =
        await buildKeywordCoverageReport(sid);

      // Count articles still missing a summary to get the true current failed count
      const currentFailedCount = await prisma.scrapedArticle.count({
        where: { sessionId: sid, summary: null },
      });

      await prisma.scrapingSession.update({
        where: { id: sid },
        data: {
          enrichedCount:         (existing.enrichedCount  || 0) + totals.enriched,
          enrichmentFailedCount: currentFailedCount,
          aiInputTokens:         (existing.aiInputTokens  || 0) + totals.inputTokens,
          aiOutputTokens:        (existing.aiOutputTokens || 0) + totals.outputTokens,
          keywordsCoveredCount:  keywordsWithContent.length,
          keywordsEmptyCount:    keywordsWithoutContent.length,
        },
      });

      updatedSessionIds.push(sid);
      console.log(`[Manual Enrichment] ✅ Session ${sid} updated (+${totals.enriched} enriched)`);
    } catch (e) {
      console.error(`[Manual Enrichment] Failed to update session ${sid}: ${e.message}`);
    }
  }

  // Build coverage report for the email (uses the filtered session or most recent updated)
  const reportSessionId = sessionId || (updatedSessionIds[0] ?? null);

  let keywordsWithContent    = [];
  let keywordsWithoutContent = [];
  if (reportSessionId) {
    ({ keywordsWithContent, keywordsWithoutContent } =
      await buildKeywordCoverageReport(reportSessionId));
  }

  // Send completion email unless disabled via env or parameter
  const emailEnabled = sendEmail && process.env.SEND_MANUAL_ENRICHMENT_EMAIL !== "false";

  if (emailEnabled && reportSessionId) {
    try {
      const { sendCompletionNotification } = require("./email.service");

      const reportSession = await prisma.scrapingSession.findUnique({
        where:  { id: reportSessionId },
        select: {
          id: true, startedAt: true, totalSources: true,
          successCount: true, duplicateCount: true, failureCount: true,
          successRate: true, durationMinutes: true,
        },
      });

      if (reportSession) {
        await sendCompletionNotification({
          sessionId:            reportSession.id,
          startedAt:            reportSession.startedAt,
          totalSources:         reportSession.totalSources,
          successCount:         reportSession.successCount,
          duplicateCount:       reportSession.duplicateCount,
          failureCount:         reportSession.failureCount,
          successRate:          reportSession.successRate,
          durationMinutes:      reportSession.durationMinutes,
          enrichedCount:        totalEnriched,
          enrichmentFailed:     totalFailed,
          keywordsWithContent,
          keywordsWithoutContent,
          totalKeywordsCovered: keywordsWithContent.length,
          totalKeywordsEmpty:   keywordsWithoutContent.length,
          aiTokenUsage: {
            inputTokens:      tokenTracker.inputTokens,
            outputTokens:     tokenTracker.outputTokens,
            estimatedCostUSD: calculateEstimatedCost(tokenTracker),
          },
          criticalErrors:     false,
          isManualEnrichment: true,
          sessionsUpdated:    updatedSessionIds,
        });
        console.log(`[Manual Enrichment] Email sent (${updatedSessionIds.length} session(s) updated)`);
      }
    } catch (emailErr) {
      console.error(`[Manual Enrichment] Email failed: ${emailErr.message}`);
    }
  }

  console.log(`\n[Manual Enrichment] ═══ Complete ═══`);
  console.log(`[Manual Enrichment] Found: ${totalFound} | ✅ ${totalEnriched} enriched | ❌ ${totalFailed} failed`);
  console.log(`[Manual Enrichment] Sessions updated: ${updatedSessionIds.join(", ") || "none"}`);

  return {
    totalFound,
    enrichedCount:          totalEnriched,
    enrichmentFailed:       totalFailed,
    sessionsUpdated:        updatedSessionIds,
    keywordsWithContent,
    keywordsWithoutContent,
    tokenUsage: {
      inputTokens:      tokenTracker.inputTokens,
      outputTokens:     tokenTracker.outputTokens,
      estimatedCostUSD: calculateEstimatedCost(tokenTracker),
    },
  };
}

module.exports = { runEnrichmentStage, runManualEnrichment };