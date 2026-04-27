// src/services/enrichment.service.js
// Phase 3a — AI enrichment: summarizes scraped articles and matches them to keywords.
// Uses OpenRouter API with multi-key and multi-model fallback to handle rate limits.

const { OpenAI } = require("openai");
const prisma     = require("../config/prisma");
const { CATEGORY_KEYWORDS } = require("../config/categoryKeywords");

// ── Build API clients (one per OPENROUTER_API_KEY* env variable found) ────────
// Supports up to 3 keys: OPENROUTER_API_KEY, OPENROUTER_API_KEY_2, OPENROUTER_API_KEY_3.
// Each key has its own independent rate limit quota.
function buildClients() {
  const keys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
  ].filter(Boolean);

  if (!keys.length) {
    console.warn("[Enrichment] ⚠️  No OPENROUTER_API_KEY found in environment.");
    return [];
  }

  return keys.map((apiKey) =>
    new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey })
  );
}

const CLIENTS = buildClients();

// Free models tried in order — first available wins
const ENRICHMENT_MODELS = [
  "openai/gpt-oss-120b:free",
  "google/gemma-4-31b-it:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

// Batch and delay settings
const BATCH_SIZE             = 3;    // articles per AI call
const API_CALL_DELAY_MS      = 1200; // delay between batches
const KEY_SWITCH_PAUSE_MS    = 300;  // pause before switching to the next API key after a 429
const ARTICLE_RETRY_DELAY_MS = 500;  // delay between individual article retries in fallback mode

// AI call settings
const MAX_TOKENS_BATCH      = 900;  // max output tokens for batch calls
const MAX_TOKENS_INDIVIDUAL = 600;  // max output tokens for individual article fallback calls
const AI_TEMPERATURE        = 0.1;  // low temperature for consistent, factual output
const MAX_CONTENT_CHARS     = 10000; // max article content characters sent to the AI per article

// Summary length constraints (reflected in the AI prompt)
const SUMMARY_MIN_WORDS = 130;
const SUMMARY_MAX_WORDS = 150;

// Rate limit and backoff settings
const RATE_LIMIT_RESET_MS  = 60000;                               // OpenRouter rate limit window
const BACKOFF_DELAYS_MS    = [2000, 4000, 8000, 16000, 30000, 60000]; // exponential backoff sequence

// Token cost rates (USD per token) — only applied when a paid (non-free) model was used
const AI_TOKEN_COST_INPUT  = 0.00000015;
const AI_TOKEN_COST_OUTPUT = 0.0000006;

// Returns the estimated cost for a session's token usage.
// Cost is only calculated if a paid model was used — free models always return 0.
function calculateEstimatedCost(tokenTracker) {
  if (!tokenTracker.usedPaidModel) return 0;
  return parseFloat(
    ((tokenTracker.inputTokens * AI_TOKEN_COST_INPUT) + (tokenTracker.outputTokens * AI_TOKEN_COST_OUTPUT)).toFixed(4)
  );
}


// ── RateLimitManager ──────────────────────────────────────────────────────────
// Tracks whether the account is currently rate-limited and computes backoff wait times.
class RateLimitManager {
  constructor() {
    this.isAccountLimited = false;
    this.lastLimitTime    = null;
    this.limitResetTime   = null;
    this.failedBatchCount = 0;
  }

  // Marks the account as rate-limited, setting a 60-second reset window.
  markLimited() {
    this.isAccountLimited = true;
    this.lastLimitTime    = Date.now();
    this.limitResetTime   = Date.now() + RATE_LIMIT_RESET_MS;
  }

  // Returns true if the rate limit window has passed and we can try again.
  isLimitExpired() {
    if (!this.isAccountLimited) return false;
    if (Date.now() >= this.limitResetTime) {
      console.log("[RateLimit] Limit window expired. Retrying...");
      this.isAccountLimited = false;
      return true;
    }
    return false;
  }

  // Returns the next exponential backoff wait time in milliseconds.
  getWaitTime() {
    const delays = BACKOFF_DELAYS_MS;
    return delays[Math.min(this.failedBatchCount, delays.length - 1)];
  }
}

const rateLimitMgr = new RateLimitManager();

// Detects rate limit (429) errors from any shape of OpenAI/OpenRouter error object.
function is429(err) {
  return (
    err.status === 429 ||
    err.statusCode === 429 ||
    (typeof err.message === "string" && err.message.includes("429"))
  );
}

// Sends a request to OpenRouter, trying every API key × every model in order.
// Falls back to exponential backoff if all keys and models are exhausted.
async function callOpenRouter(messages, maxTokens = MAX_TOKENS_BATCH, retryAttempt = 0) {
  if (rateLimitMgr.isAccountLimited && !rateLimitMgr.isLimitExpired()) {
    const waitMs = rateLimitMgr.getWaitTime();
    console.warn(`[RateLimit] Limit active. Waiting ${waitMs}ms before retrying...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  let lastError;

  for (const model of ENRICHMENT_MODELS) {
    for (let ki = 0; ki < CLIENTS.length; ki++) {
      const client   = CLIENTS[ki];
      const keyLabel = ki === 0 ? "primary" : `key-${ki + 1}`;

      try {
        const completion = await client.chat.completions.create({
          model,
          messages,
          max_tokens:  maxTokens,
          temperature: AI_TEMPERATURE,
        });

        const content = completion.choices[0]?.message?.content || "";
        const usage   = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };

        if (rateLimitMgr.isAccountLimited) {
          console.log(`[RateLimit] ✅ Recovered on ${keyLabel}/${model}. Resuming.`);
          rateLimitMgr.isAccountLimited = false;
          rateLimitMgr.failedBatchCount = 0;
        }

        return { content, usage, model, keyIndex: ki };

      } catch (err) {
        lastError = err;

        if (is429(err)) {
          console.warn(`[RateLimit] 429 on ${keyLabel}/${model} — trying next key...`);
          rateLimitMgr.markLimited();
          await new Promise((r) => setTimeout(r, KEY_SWITCH_PAUSE_MS));
          continue;
        }

        console.warn(`[Enrichment] ${keyLabel}/${model} error: ${err.message}`);
        break; // non-429 error: skip to next model
      }
    }
    rateLimitMgr.failedBatchCount++;
  }

  // All keys × all models exhausted — wait and retry once
  if (retryAttempt === 0) {
    const waitMs = rateLimitMgr.getWaitTime();
    console.warn(`[RateLimit] All keys/models exhausted. Waiting ${waitMs}ms then retrying once...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return callOpenRouter(messages, maxTokens, 1);
  }

  throw lastError || new Error("All API keys and models exhausted after retry");
}

// Parses the AI response into a JSON array, handling markdown fences and common malformations.
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
  } catch {
    const fixed = cleaned
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\n/g, "\\n");
    return JSON.parse(fixed);
  }
}

// Builds the AI prompt asking for keyword matching and a summary (SUMMARY_MIN_WORDS–SUMMARY_MAX_WORDS words) for each article.
function buildBatchPrompt(articles, categoryKeywords) {
  const articlesText = articles.map((a, i) =>
    `--- ARTICLE ${i + 1} (ID: ${a.id}) ---\n` +
    `Title: ${a.title}\n\n` +
    `Content:\n${a.content.slice(0, MAX_CONTENT_CHARS)}`
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
        `2. SUMMARY: Write exactly ${SUMMARY_MIN_WORDS}-${SUMMARY_MAX_WORDS} words summarizing the article's CORE content.\n` +
        `   Rules:\n` +
        `   - Use ONLY information explicitly stated in the article\n` +
        `   - Do not use only the introduction — cover the main arguments/findings\n` +
        `   - Do not make inferences or add context not in the article\n` +
        `   - Write in third person, factual tone\n\n` +
        `Respond with ONLY a JSON array:\n` +
        `[\n` +
        `  {"id":"<article ID>","matchedKeywords":["keyword1","keyword2"],"summary":"<${SUMMARY_MIN_WORDS}-${SUMMARY_MAX_WORDS} word summary>"},\n` +
        `  ...\n` +
        `]`,
    },
  ];
}

// Sends one batch of articles to the AI and saves the results. Falls back to one-by-one processing if the batch fails.
async function processBatch(articles, categoryKeywords, tokenTracker, sessionId, logFn) {
  let enriched = 0;
  let failed   = 0;

  // Try batch processing first
  try {
    const messages                    = buildBatchPrompt(articles, categoryKeywords);
    const { content, usage, model }   = await callOpenRouter(messages, MAX_TOKENS_BATCH);

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
      const messages                    = buildBatchPrompt([article], categoryKeywords);
      const { content, usage, model }   = await callOpenRouter(messages, MAX_TOKENS_INDIVIDUAL);

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

// Counts how many articles in a session matched each keyword, split into covered vs uncovered.
async function buildKeywordCoverageReport(sessionId) {
  const keywordsWithContent    = [];
  const keywordsWithoutContent = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      const count = await prisma.scrapedArticle.count({
        where: { sessionId, category, matchedKeywords: { has: keyword } },
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

// Writes a single enrichment event to the ScrapingLog table.
async function writeLog(sessionId, logType, url, category, reason, details = {}) {
  await prisma.scrapingLog.create({
    data: { sessionId, logType, url, category, reason, details },
  });
}

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

    // Write partial enrichment progress to the session row after each category.
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

      const tokensBefore       = { input: tokenTracker.inputTokens, output: tokenTracker.outputTokens };
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

      // Count articles still missing a summary to get the true current failed count.
      // This replaces the old additive approach which never decremented previously failed articles.
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