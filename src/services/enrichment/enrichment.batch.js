// @ts-nocheck
// src/services/enrichment/enrichment.batch.js
// Sends article batches to the AI and saves results. Falls back to one-by-one on parse failure.

const prisma = require("../../config/prisma");

const { MAX_TOKENS_BATCH, MAX_TOKENS_INDIVIDUAL, ARTICLE_RETRY_DELAY_MS } = require("./enrichment.constants");
const { callOpenRouter }                                                    = require("./enrichment.api");
const { parseEnrichmentResponse, buildBatchPrompt }                        = require("./enrichment.parser");

// Sends one batch of articles to the AI and saves the results. Falls back to one-by-one processing if the batch fails.
async function processBatch(articles, categoryKeywords, tokenTracker, sessionId, logFn) {
  let enriched = 0;
  let failed   = 0;

  // Try batch processing first
  try {
    const messages                  = buildBatchPrompt(articles, categoryKeywords);
    const { content, usage, model } = await callOpenRouter(messages, MAX_TOKENS_BATCH);

    tokenTracker.inputTokens  += usage.prompt_tokens;
    tokenTracker.outputTokens += usage.completion_tokens;
    if (!model.endsWith(":free")) tokenTracker.usedPaidModel = true;

    try {
      const results = parseEnrichmentResponse(content);

      for (const result of results) {
        const article = articles.find((a) => a.id === result.id);
        if (!article) continue;

        try {
          await prisma.scrapedArticle.update({
            where: { id: result.id },
            data: {
              summary:         result.summary || null,
              matchedKeywords: Array.isArray(result.matchedKeywords) ? result.matchedKeywords : [],
            },
          });
          enriched++;
        } catch (dbErr) {
          console.error(`[Enrichment] DB update failed for ${result.id}: ${dbErr.message}`);
          failed++;
          logFn("enrichment_error", article.sourceUrl, article.category, `DB update: ${dbErr.message}`);
        }
      }

      return { enriched, failed };

    } catch (parseErr) {
      console.warn(`[Enrichment] Batch parse failed: ${parseErr.message} — falling back to individual`);
    }

  } catch (err) {
    console.warn(`[Enrichment] Batch call failed: ${err.message} — falling back to individual`);
  }

  // Fallback: process each article one at a time
  console.log(`[Enrichment] Processing ${articles.length} articles individually...`);

  for (const article of articles) {
    try {
      const messages                  = buildBatchPrompt([article], categoryKeywords);
      const { content, usage, model } = await callOpenRouter(messages, MAX_TOKENS_INDIVIDUAL);

      tokenTracker.inputTokens  += usage.prompt_tokens;
      tokenTracker.outputTokens += usage.completion_tokens;
      if (!model.endsWith(":free")) tokenTracker.usedPaidModel = true;

      const results = parseEnrichmentResponse(content);
      const result  = results[0];

      if (result) {
        await prisma.scrapedArticle.update({
          where: { id: article.id },
          data: {
            summary:         result.summary || null,
            matchedKeywords: Array.isArray(result.matchedKeywords) ? result.matchedKeywords : [],
          },
        });
        enriched++;
      }

    } catch (err) {
      console.error(`[Enrichment] Article ${article.id} failed: ${err.message}`);
      failed++;
      logFn("enrichment_error", article.sourceUrl, article.category, err.message);
    }

    await new Promise((r) => setTimeout(r, ARTICLE_RETRY_DELAY_MS));
  }

  return { enriched, failed };
}

module.exports = { processBatch };
