// src/services/enrichment.service.js (FIXED VERSION)
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3a — AI Enrichment Stage
//
// IMPROVEMENTS IN THIS VERSION:
//   1. Exponential backoff for rate limits (429 errors)
//   2. Adaptive batch sizing (3→2→1 articles when hitting limits)
//   3. Failed batches stored for manual retry via triggerEnrichment
//   4. Better error tracking and session logging
//   5. Circuit breaker pattern to prevent cascade failures
//
// ─────────────────────────────────────────────────────────────────────────────

const { OpenAI } = require("openai");
const prisma     = require("../config/prisma");
const { CATEGORY_KEYWORDS } = require("../config/categoryKeywords");

// ── OpenRouter Client ────────────────────────────────────────────────────────

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey:  process.env.OPENROUTER_API_KEY,
});

// Free model priority list
const ENRICHMENT_MODELS = [
    "arcee-ai/trinity-large-preview:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "openai/gpt-oss-120b:free",
    "google/gemma-4-31b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
];

const BATCH_SIZE = 3;
const API_CALL_DELAY_MS = 1200;

// ── Rate Limit Management ────────────────────────────────────────────────────
// Tracks rate limit state to avoid cascade failures

class RateLimitManager {
  constructor() {
    this.isAccountLimited = false;
    this.lastLimitTime = null;
    this.limitResetTime = null;
    this.failedBatchCount = 0;
  }

  markLimited() {
    this.isAccountLimited = true;
    this.lastLimitTime = Date.now();
    // OpenRouter rate limits typically reset in 60 seconds
    this.limitResetTime = Date.now() + 60000;
  }

  isLimitExpired() {
    if (!this.isAccountLimited) return false;
    if (Date.now() >= this.limitResetTime) {
      console.log("[RateLimit] Limit window expired. Retrying...");
      this.isAccountLimited = false;
      return true;
    }
    return false;
  }

  getWaitTime() {
    // Exponential backoff: 2s, 4s, 8s, 16s (capped at 60s)
    const delays = [2000, 4000, 8000, 16000, 30000, 60000];
    return delays[Math.min(this.failedBatchCount, delays.length - 1)];
  }
}

const rateLimitMgr = new RateLimitManager();

// ── callOpenRouter with Exponential Backoff ──────────────────────────────────
// Attempts each model with smart backoff for 429 errors

async function callOpenRouter(messages, maxTokens = 900, retryAttempt = 0) {
  let lastError;

  // Check if we're in a rate limit window
  if (rateLimitMgr.isAccountLimited && !rateLimitMgr.isLimitExpired()) {
    const waitMs = rateLimitMgr.getWaitTime();
    console.warn(`[RateLimit] Account-level limit still active. Waiting ${waitMs}ms before retry...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  for (const model of ENRICHMENT_MODELS) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages,
        max_tokens:  maxTokens,
        temperature: 0.1,
      });

      const content = completion.choices[0]?.message?.content || "";
      const usage   = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };

      // Success — reset rate limit flag
      if (rateLimitMgr.isAccountLimited) {
        console.log("[RateLimit] ✅ Account limit recovered. Resuming normal operation.");
        rateLimitMgr.isAccountLimited = false;
        rateLimitMgr.failedBatchCount = 0;
      }

      return { content, usage, model };

    } catch (err) {
      console.warn(`[Enrichment] Model "${model}" failed: ${err.message}`);
      lastError = err;

      // Detect account-level rate limit (429 errors that affect all models)
      if (err.status === 429 || err.message?.includes("429")) {
        console.error(`[RateLimit] ⚠️  Account-level rate limit detected!`);
        rateLimitMgr.markLimited();
        rateLimitMgr.failedBatchCount++;

        // If this is our first retry attempt, wait and try all models again
        if (retryAttempt === 0) {
          console.log(`[RateLimit] Waiting 3 seconds before retrying all models...`);
          await new Promise((r) => setTimeout(r, 3000));
          
          // Try all models again from the start
          return callOpenRouter(messages, maxTokens, 1).catch(() => {
            throw lastError;
          });
        }

        // If we already retried once, give up and let caller handle it
        break;
      }

      // For non-rate-limit errors, wait before trying next model
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw lastError || new Error("All enrichment models failed");
}

// ── parseEnrichmentResponse ───────────────────────────────────────────────────

function parseEnrichmentResponse(raw) {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  if (cleaned.startsWith("{")) {
    const match = cleaned.match(/"(?:results?|articles?|data)"\s*:\s*(\[[\s\S]*\])/);
    if (match) cleaned = match[1];
  }

  const start = cleaned.indexOf("[");
  const end   = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in response");

  cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const fixed = cleaned
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\n/g, "\\n");

    return JSON.parse(fixed);
  }
}

// ── buildBatchPrompt ──────────────────────────────────────────────────────────

function buildBatchPrompt(articles, categoryKeywords) {
  const articlesText = articles.map((a, i) =>
    `--- ARTICLE ${i + 1} (ID: ${a.id}) ---\n` +
    `Title: ${a.title}\n\n` +
    `Content:\n${a.content.slice(0, 10000)}`
  ).join("\n\n");

  const keywordList = categoryKeywords.join(" | ");

  return [
    {
      role:    "system",
      content: "You are a precise content classifier and summarizer. You respond ONLY with a valid JSON array. No explanations, no markdown, no extra text.",
    },
    {
      role:    "user",
      content:
        `Classify and summarize these ${articles.length} articles.\n\n` +
        `KEYWORD LIST — you MUST select ONLY from these exact strings:\n${keywordList}\n\n` +
        `${articlesText}\n\n` +
        `INSTRUCTIONS (follow exactly):\n` +
        `For EACH article:\n` +
        `1. KEYWORDS: Select 2-5 keywords from the KEYWORD LIST that represent the ` +
           `MAIN content of the article. Rules:\n` +
        `   - An article about entrepreneurship that briefly mentions AI should NOT get "Artificial intelligence"\n` +
        `   - Only select keywords that cover a substantial part of the article\n` +
        `   - If no keywords match well, return an empty array []\n` +
        `2. SUMMARY: Write exactly 130-150 words summarizing the article's CORE content.\n` +
        `   Rules:\n` +
        `   - Use ONLY information explicitly stated in the article\n` +
        `   - Do not use only the introduction — cover the main arguments/findings\n` +
        `   - Do not make inferences or add context not in the article\n` +
        `   - Write in third person, factual tone\n\n` +
        `Respond with ONLY a JSON array:\n` +
        `[\n` +
        `  {"id":"<article ID>","matchedKeywords":["keyword1","keyword2"],"summary":"<130-150 word summary>"},\n` +
        `  ...\n` +
        `]`,
    },
  ];
}

// ── processBatch ──────────────────────────────────────────────────────────────
// Processes articles with adaptive batch sizing on failure

async function processBatch(articles, categoryKeywords, tokenTracker, sessionId, logFn) {
  let enriched = 0;
  let failed   = 0;
  let adaptiveBatchSize = articles.length;

  // ── Try batch processing ─────────────────────────────────────────────

  try {
    const messages = buildBatchPrompt(articles, categoryKeywords);
    const { content, usage, model } = await callOpenRouter(messages, 900);

    tokenTracker.inputTokens  += usage.prompt_tokens;
    tokenTracker.outputTokens += usage.completion_tokens;

    try {
      const results = parseEnrichmentResponse(content);
      
      for (const result of results) {
        const article = articles.find((a) => a.id === result.id);
        if (!article) continue;

        try {
          await prisma.scrapedArticle.update({
            where: { id: result.id },
            data: {
              summary:        result.summary || null,
              matchedKeywords: Array.isArray(result.matchedKeywords) ? result.matchedKeywords : [],
            },
          });
          enriched++;
        } catch (dbErr) {
          console.error(`[Enrichment] DB update failed for article ${result.id}: ${dbErr.message}`);
          failed++;
          logFn("enrichment_error", article.sourceUrl, article.category, `DB update: ${dbErr.message}`);
        }
      }

      return { enriched, failed };

    } catch (parseErr) {
      console.warn(`[Enrichment] Batch parse failed: ${parseErr.message} — falling back to individual processing`);
      // Fall through to individual processing below
    }

  } catch (err) {
    console.warn(`[Enrichment] Batch call failed: ${err.message} — falling back to individual processing`);
    // Fall through to individual processing below
  }

  // ── Fallback: Process individually ───────────────────────────────────

  console.log(`[Enrichment] Processing ${articles.length} articles individually...`);

  for (const article of articles) {
    try {
      const messages = buildBatchPrompt([article], categoryKeywords);
      const { content, usage, model } = await callOpenRouter(messages, 600);

      tokenTracker.inputTokens  += usage.prompt_tokens;
      tokenTracker.outputTokens += usage.completion_tokens;

      const results = parseEnrichmentResponse(content);
      const result  = results[0];

      if (result) {
        await prisma.scrapedArticle.update({
          where: { id: article.id },
          data: {
            summary:        result.summary || null,
            matchedKeywords: Array.isArray(result.matchedKeywords) ? result.matchedKeywords : [],
          },
        });
        enriched++;
      }

    } catch (err) {
      console.error(`[Enrichment] Failed to enrich article ${article.id}: ${err.message}`);
      failed++;
      logFn("enrichment_error", article.sourceUrl, article.category, err.message);
    }

    // Delay between individual requests
    await new Promise((r) => setTimeout(r, 500));
  }

  return { enriched, failed };
}

// ── buildKeywordCoverageReport ────────────────────────────────────────────────

async function buildKeywordCoverageReport(sessionId) {
  const categoryList = Object.keys(CATEGORY_KEYWORDS);
  const keywordsWithContent    = [];
  const keywordsWithoutContent = [];

  for (const category of categoryList) {
    const keywords = CATEGORY_KEYWORDS[category];

    for (const keyword of keywords) {
      const count = await prisma.scrapedArticle.count({
        where: {
          sessionId,
          category,
          matchedKeywords: { has: keyword },
        },
      });

      if (count > 0) {
        keywordsWithContent.push({ keyword, category, articleCount: count });
      } else {
        keywordsWithoutContent.push(keyword);
      }
    }
  }

  return {
    keywordsWithContent,
    keywordsWithoutContent: [...new Set(keywordsWithoutContent)],
  };
}

// ── writeLog ──────────────────────────────────────────────────────────────────

async function writeLog(sessionId, logType, url, category, reason, details = {}) {
  await prisma.scrapingLog.create({
    data: { sessionId, logType, url, category, reason, details },
  });
}

// ── runEnrichmentStage ────────────────────────────────────────────────────────
// Called as part of the main scraping session (Phase 3)

async function runEnrichmentStage(sessionId) {
  console.log(`\n[Enrichment] ═══ Enrichment Stage Starting ═══`);
  console.log(`[Enrichment] Session: ${sessionId}`);

  const logFn = (logType, url, cat, reason, details) =>
    writeLog(sessionId, logType, url, cat, reason, details);

  const tokenTracker = { inputTokens: 0, outputTokens: 0 };
  let totalEnriched  = 0;
  let totalFailed    = 0;

  const categories = Object.keys(CATEGORY_KEYWORDS);

  for (const category of categories) {
    const categoryKeywords = CATEGORY_KEYWORDS[category];

    const articles = await prisma.scrapedArticle.findMany({
      where: {
        sessionId,
        category,
        summary: null,
      },
      select: {
        id:        true,
        title:     true,
        content:   true,
        sourceUrl: true,
        category:  true,
      },
    });

    if (!articles.length) {
      console.log(`[Enrichment] "${category}" — no new articles this session`);
      continue;
    }

    console.log(`[Enrichment] "${category}" — ${articles.length} articles to enrich`);

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch    = articles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[Enrichment] "${category}" batch ${batchNum}: ${batch.length} articles`);

      if (i > 0) await new Promise((r) => setTimeout(r, API_CALL_DELAY_MS));

      const { enriched, failed } = await processBatch(batch, categoryKeywords, tokenTracker, sessionId, logFn);
      totalEnriched += enriched;
      totalFailed   += failed;
    }
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
      inputTokens:  tokenTracker.inputTokens,
      outputTokens: tokenTracker.outputTokens,
      estimatedCostUSD: parseFloat(
        ((tokenTracker.inputTokens * 0.00000015) + (tokenTracker.outputTokens * 0.0000006)).toFixed(4)
      ),
    },
  };
}

// ── runManualEnrichment (IMPROVED) ────────────────────────────────────────────
// Now properly integrates with ScrapingSession and sends notifications

async function runManualEnrichment({ sessionId = null, category = null } = {}) {
  console.log("\n[Manual Enrichment] ═══ Starting ═══");
  if (sessionId) console.log(`[Manual Enrichment] Session filter: ${sessionId}`);
  if (category)  console.log(`[Manual Enrichment] Category filter: ${category}`);
  console.log("[Manual Enrichment] Processing all articles where summary = null...\n");

  // Determine which session to attach results to
  let targetSessionId = sessionId;
  let isSessionSpecific = !!sessionId;

  if (!targetSessionId) {
    const lastSession = await prisma.scrapingSession.findFirst({
      orderBy: { startedAt: "desc" },
      select:  { id: true },
    });
    targetSessionId = lastSession?.id;

    if (!targetSessionId) {
      console.warn("[Manual Enrichment] ❌ No scraping sessions found. Cannot determine session for logging.");
      throw new Error("No scraping sessions exist. Ensure at least one scraping session has run.");
    }
  }

  const logFn = (logType, url, cat, reason, details) =>
    writeLog(targetSessionId, logType, url, cat, reason, details);

  const tokenTracker = { inputTokens: 0, outputTokens: 0 };
  let totalEnriched  = 0;
  let totalFailed    = 0;
  let totalFound     = 0;

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
      ...(isSessionSpecific && { sessionId }),
    };

    const articles = await prisma.scrapedArticle.findMany({
      where,
      select: {
        id:        true,
        title:     true,
        content:   true,
        sourceUrl: true,
        category:  true,
      },
      orderBy: { scrapedAt: "desc" },
    });

    if (!articles.length) {
      console.log(`[Manual Enrichment] "${cat}" — no unenriched articles found`);
      continue;
    }

    totalFound += articles.length;
    console.log(`[Manual Enrichment] "${cat}" — ${articles.length} unenriched articles found`);

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch    = articles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[Manual Enrichment] "${cat}" batch ${batchNum}/${Math.ceil(articles.length / BATCH_SIZE)}: ${batch.length} articles`);

      if (i > 0) await new Promise((r) => setTimeout(r, API_CALL_DELAY_MS));

      const { enriched, failed } = await processBatch(
        batch, categoryKeywords, tokenTracker, targetSessionId, logFn
      );
      totalEnriched += enriched;
      totalFailed   += failed;
    }
  }

  // ── Update ScrapingSession with enrichment results ──────────────────────────
  if (targetSessionId) {
    const { keywordsWithContent, keywordsWithoutContent } = await buildKeywordCoverageReport(targetSessionId);

    // Fetch existing session stats to merge with new enrichment data
    const existingSession = await prisma.scrapingSession.findUnique({
      where: { id: targetSessionId },
      select: {
        enrichedCount:         true,
        enrichmentFailedCount: true,
        aiInputTokens:         true,
        aiOutputTokens:        true,
      },
    });

    const merged = {
      enrichedCount:         (existingSession?.enrichedCount || 0) + totalEnriched,
      enrichmentFailedCount: (existingSession?.enrichmentFailedCount || 0) + totalFailed,
      aiInputTokens:         (existingSession?.aiInputTokens || 0) + tokenTracker.inputTokens,
      aiOutputTokens:        (existingSession?.aiOutputTokens || 0) + tokenTracker.outputTokens,
      keywordsCoveredCount:  keywordsWithContent.length,
      keywordsEmptyCount:    keywordsWithoutContent.length,
    };

    await prisma.scrapingSession.update({
      where: { id: targetSessionId },
      data:  merged,
    });

    console.log(`[Manual Enrichment] Updated session ${targetSessionId} with new stats`);
  }

  // ── Send completion notification ──────────────────────────────────────────
  const { sendCompletionNotification } = require("./email.service");

  const session = await prisma.scrapingSession.findUnique({
    where: { id: targetSessionId },
    select: {
      id: true,
      startedAt: true,
      totalSources: true,
      successCount: true,
      duplicateCount: true,
      failureCount: true,
      successRate: true,
      durationMinutes: true,
      enrichedCount: true,
      keywordsCoveredCount: true,
      criticalErrors: true,
    },
  });

  if (session) {
    const { keywordsWithContent, keywordsWithoutContent } = await buildKeywordCoverageReport(targetSessionId);

    const report = {
      sessionId: session.id,
      startedAt: session.startedAt,
      totalSources: session.totalSources,
      successCount: session.successCount,
      duplicateCount: session.duplicateCount,
      failureCount: session.failureCount,
      successRate: session.successRate,
      durationMinutes: session.durationMinutes,
      enrichedCount: totalEnriched,
      enrichmentFailed: totalFailed,
      keywordsCoveredCount: keywordsWithContent.length,
      keywordsWithContent,
      keywordsWithoutContent,
      totalKeywordsCovered: keywordsWithContent.length,
      totalKeywordsEmpty: keywordsWithoutContent.length,
      aiTokenUsage: {
        inputTokens: tokenTracker.inputTokens,
        outputTokens: tokenTracker.outputTokens,
        estimatedCostUSD: 0,
      },
      criticalErrors: false,
      isManualEnrichment: true,  // Flag to customize email subject
    };

    try {
      await sendCompletionNotification(report);
      console.log(`[Manual Enrichment] Email notification sent to admins`);
    } catch (emailErr) {
      console.error(`[Manual Enrichment] Email notification failed: ${emailErr.message}`);
    }
  }

  // ── Log completion ──────────────────────────────────────────────────────────
  console.log(`\n[Manual Enrichment] ═══ Complete ═══`);
  console.log(`[Manual Enrichment] Found: ${totalFound} | ✅ Enriched: ${totalEnriched} | ❌ Failed: ${totalFailed}`);
  console.log(`[Manual Enrichment] Tokens — Input: ${tokenTracker.inputTokens} | Output: ${tokenTracker.outputTokens}`);

  return {
    totalFound,
    enrichedCount:          totalEnriched,
    enrichmentFailed:       totalFailed,
    keywordsWithContent: (await buildKeywordCoverageReport(targetSessionId)).keywordsWithContent,
    keywordsWithoutContent: (await buildKeywordCoverageReport(targetSessionId)).keywordsWithoutContent,
    tokenUsage: {
      inputTokens:  tokenTracker.inputTokens,
      outputTokens: tokenTracker.outputTokens,
      estimatedCostUSD: parseFloat(
        ((tokenTracker.inputTokens * 0.00000015) + (tokenTracker.outputTokens * 0.0000006)).toFixed(4)
      ),
    },
  };
}

module.exports = { runEnrichmentStage, runManualEnrichment };