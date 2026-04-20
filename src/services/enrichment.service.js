// src/services/enrichment.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3a — AI Enrichment Stage
//
// RATE LIMIT STRATEGY (three layers):
//
//   Layer 1 — Multiple API keys (highest impact)
//     Add additional developer OpenRouter keys to .env:
//       OPENROUTER_API_KEY=sk-or-v1-...       ← primary (always required)
//       OPENROUTER_API_KEY_2=sk-or-v1-...     ← developer 2 (optional)
//       OPENROUTER_API_KEY_3=sk-or-v1-...     ← developer 3 (optional)
//     Each key has its own independent rate limit quota.
//     When key 1 is blocked, key 2 is tried, then key 3, etc.
//     Even with one key this works — Layer 2 and 3 still apply.
//
//   Layer 2 — Per-model fallback
//     Within each API key, if model 1 returns 429, model 2 is tried, etc.
//     (Note: if you hit the account-level limit, all models on that key
//     will also be blocked — that is when the next API key is tried.)
//
//   Layer 3 — Exponential backoff
//     If all keys AND all models are exhausted, wait and retry:
//     2s → 4s → 8s → 16s → 30s → 60s before giving up entirely.
// ─────────────────────────────────────────────────────────────────────────────

const { OpenAI } = require("openai");
const prisma     = require("../config/prisma");
const { CATEGORY_KEYWORDS } = require("../config/categoryKeywords");

// ── Build the list of OpenRouter clients (one per API key) ───────────────────
// Reads every OPENROUTER_API_KEY* env variable that is set.
// Falls back gracefully if only the primary key is present.

function buildClients() {
  const keys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
  ].filter(Boolean); // remove any undefined / empty slots

  if (!keys.length) {
    console.warn("[Enrichment] ⚠️  No OPENROUTER_API_KEY found in environment.");
    return [];
  }

  return keys.map((apiKey, i) =>
    new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey })
  );
}

const CLIENTS = buildClients(); // array of OpenAI client instances

// Free model priority list — best for structured JSON tasks first
const ENRICHMENT_MODELS = [
  "openai/gpt-oss-120b:free",
  "google/gemma-4-31b-it:free",
   "nousresearch/hermes-3-llama-3.1-405b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const BATCH_SIZE         = 3;    // articles per AI call
const API_CALL_DELAY_MS  = 1200; // delay between batches

// ── RateLimitManager ─────────────────────────────────────────────────────────
// Tracks account-level rate limit state and computes exponential backoff.
// One shared instance across the module — resets between sessions.

class RateLimitManager {
  constructor() {
    this.isAccountLimited = false;
    this.lastLimitTime    = null;
    this.limitResetTime   = null;
    this.failedBatchCount = 0;
  }

  markLimited() {
    this.isAccountLimited = true;
    this.lastLimitTime    = Date.now();
    this.limitResetTime   = Date.now() + 60000; // OpenRouter resets in ~60s
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
    const delays = [2000, 4000, 8000, 16000, 30000, 60000];
    return delays[Math.min(this.failedBatchCount, delays.length - 1)];
  }
}

const rateLimitMgr = new RateLimitManager();

// ── is429 ─────────────────────────────────────────────────────────────────────
// Detects rate limit errors from any shape of OpenAI/OpenRouter error object.

function is429(err) {
  return (
    err.status === 429 ||
    err.statusCode === 429 ||
    (typeof err.message === "string" && err.message.includes("429"))
  );
}

// ── callOpenRouter ────────────────────────────────────────────────────────────
// Tries every API key × every model in order.
// On any 429:
//   - Moves to the next key immediately (key-level backoff)
//   - Once all keys are exhausted for a model, tries the next model
//   - If all keys + all models fail, applies exponential wait then retries once
// On non-429 errors: skips to the next model on the same key.
// Returns { content, usage, model, keyIndex } on success.
// Throws if everything is exhausted.

async function callOpenRouter(messages, maxTokens = 900, retryAttempt = 0) {
  // If we're in a known rate limit window, wait before even trying
  if (rateLimitMgr.isAccountLimited && !rateLimitMgr.isLimitExpired()) {
    const waitMs = rateLimitMgr.getWaitTime();
    console.warn(`[RateLimit] Limit active. Waiting ${waitMs}ms before retrying...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  let lastError;

  for (const model of ENRICHMENT_MODELS) {
    for (let ki = 0; ki < CLIENTS.length; ki++) {
      const client    = CLIENTS[ki];
      const keyLabel  = ki === 0 ? "primary" : `key-${ki + 1}`;

      try {
        const completion = await client.chat.completions.create({
          model,
          messages,
          max_tokens:  maxTokens,
          temperature: 0.1,
        });

        const content = completion.choices[0]?.message?.content || "";
        const usage   = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };

        // Success — clear any rate limit state
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
          // Short pause before switching keys — avoids hammering OpenRouter
          await new Promise((r) => setTimeout(r, 300));
          continue; // try next key for same model
        }

        // Non-429 (network error, model unavailable, etc.) — skip to next model
        console.warn(`[Enrichment] ${keyLabel}/${model} error: ${err.message}`);
        break; // break the keys loop, move to next model
      }
    }
    // All keys exhausted for this model — increment failure counter and try next model
    rateLimitMgr.failedBatchCount++;
  }

  // All keys × all models exhausted
  if (retryAttempt === 0) {
    const waitMs = rateLimitMgr.getWaitTime();
    console.warn(`[RateLimit] All keys/models exhausted. Waiting ${waitMs}ms then retrying once...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return callOpenRouter(messages, maxTokens, 1);
  }

  throw lastError || new Error("All API keys and models exhausted after retry");
}

// ── parseEnrichmentResponse ───────────────────────────────────────────────────
// Robustly parses the AI response JSON.
// Handles markdown fences, extra whitespace, and common malformations.

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
// Processes one batch of articles.
// On batch failure (parse error or total API exhaustion), falls back to
// processing each article individually.

async function processBatch(articles, categoryKeywords, tokenTracker, sessionId, logFn) {
  let enriched = 0;
  let failed   = 0;

  // ── Try batch ────────────────────────────────────────────────────────
  try {
    const messages = buildBatchPrompt(articles, categoryKeywords);
    const { content, usage } = await callOpenRouter(messages, 900);

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
      // Fall through to individual processing
    }

  } catch (err) {
    console.warn(`[Enrichment] Batch call failed: ${err.message} — falling back to individual`);
    // Fall through to individual processing
  }

  // ── Fallback: process each article one at a time ──────────────────────
  console.log(`[Enrichment] Processing ${articles.length} articles individually...`);

  for (const article of articles) {
    try {
      const messages = buildBatchPrompt([article], categoryKeywords);
      const { content, usage } = await callOpenRouter(messages, 600);

      tokenTracker.inputTokens  += usage.prompt_tokens;
      tokenTracker.outputTokens += usage.completion_tokens;

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

    await new Promise((r) => setTimeout(r, 500));
  }

  return { enriched, failed };
}

// ── buildKeywordCoverageReport ────────────────────────────────────────────────

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

// ── writeLog ──────────────────────────────────────────────────────────────────

async function writeLog(sessionId, logType, url, category, reason, details = {}) {
  await prisma.scrapingLog.create({
    data: { sessionId, logType, url, category, reason, details },
  });
}

// ── runEnrichmentStage ────────────────────────────────────────────────────────
// Called automatically as Phase 3 of every scraping session.

async function runEnrichmentStage(sessionId) {
  console.log(`\n[Enrichment] ═══ Enrichment Stage Starting ═══`);
  console.log(`[Enrichment] Session: ${sessionId}`);
  console.log(`[Enrichment] API keys available: ${CLIENTS.length}`);

  const logFn = (logType, url, cat, reason, details) =>
    writeLog(sessionId, logType, url, cat, reason, details);

  const tokenTracker = { inputTokens: 0, outputTokens: 0 };
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
      inputTokens:      tokenTracker.inputTokens,
      outputTokens:     tokenTracker.outputTokens,
      estimatedCostUSD: parseFloat(
        ((tokenTracker.inputTokens * 0.00000015) + (tokenTracker.outputTokens * 0.0000006)).toFixed(4)
      ),
    },
  };
}

// ── runManualEnrichment ───────────────────────────────────────────────────────
// Standalone enrichment runner for articles missed during automatic enrichment.
// Called by: scripts/triggerEnrichment.js, POST /api/scraper/enrich
//
// DESIGN NOTES:
//   No separate "ManualEnrichmentSession" model is needed.
//   Every ScrapedArticle already has a sessionId FK pointing to the
//   ScrapingSession that created it. When we enrich those articles we
//   simply update the stats on their own session(s) directly.
//
//   When no sessionId filter is provided, articles from multiple sessions
//   may be enriched in one run. We track per-session totals in a Map
//   and update each session record individually at the end.
//
// options.sessionId — restrict to articles from one session (optional)
// options.category  — restrict to one category (optional)
// options.sendEmail — send completion email when done (default: true)

async function runManualEnrichment({
  sessionId  = null,
  category   = null,
  sendEmail  = true,
} = {}) {
  console.log("\n[Manual Enrichment] ═══ Starting ═══");
  if (sessionId) console.log(`[Manual Enrichment] Session filter: ${sessionId}`);
  if (category)  console.log(`[Manual Enrichment] Category filter: ${category}`);
  console.log(`[Manual Enrichment] API keys available: ${CLIENTS.length}`);

  // Verify at least one session exists (needed to write logs)
  if (!sessionId) {
    const anySession = await prisma.scrapingSession.findFirst({
      orderBy: { startedAt: "desc" },
      select:  { id: true },
    });
    if (!anySession) {
      throw new Error("No scraping sessions exist. Run a scraping session first.");
    }
  }

  const tokenTracker = { inputTokens: 0, outputTokens: 0 };
  let totalEnriched  = 0;
  let totalFailed    = 0;
  let totalFound     = 0;

  // per-session counters — key: sessionId, value: { enriched, failed, inputTokens, outputTokens }
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

    // Fetch articles including their sessionId so we know which session to update
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

      // Use the first article's sessionId as the log target for this batch
      // (all articles in a batch are from the same category query — may be mixed sessions
      // when no sessionId filter is set, so we log to the article's own session)
      const logSessionId = batch[0].sessionId;
      const logFn = (logType, url, cat2, reason, details) =>
        writeLog(logSessionId, logType, url, cat2, reason, details);

      // Track token usage before batch so we can attribute new tokens to the right sessions
      const tokensBefore = { input: tokenTracker.inputTokens, output: tokenTracker.outputTokens };

      const { enriched, failed } = await processBatch(
        batch, categoryKeywords, tokenTracker, logSessionId, logFn
      );

      const tokensUsedInput  = tokenTracker.inputTokens  - tokensBefore.input;
      const tokensUsedOutput = tokenTracker.outputTokens - tokensBefore.output;

      // Attribute enrichment results to each article's own session
      // Group batch articles by session
      const batchSessionGroups = new Map();
      for (const article of batch) {
        if (!batchSessionGroups.has(article.sessionId)) {
          batchSessionGroups.set(article.sessionId, 0);
        }
        batchSessionGroups.set(
          article.sessionId,
          batchSessionGroups.get(article.sessionId) + 1
        );
      }

      // For simplicity, attribute all enriched/failed to the batch's primary session
      // (tokens are split proportionally by article count per session)
      for (const [sid, articleCount] of batchSessionGroups) {
        if (!sessionTotals.has(sid)) {
          sessionTotals.set(sid, { enriched: 0, failed: 0, inputTokens: 0, outputTokens: 0 });
        }
        const fraction = articleCount / batch.length;
        const st = sessionTotals.get(sid);
        // Attribute enriched/failed proportionally per session when mixed
        st.enriched      += Math.round(enriched * fraction);
        st.failed        += Math.round(failed   * fraction);
        st.inputTokens   += Math.round(tokensUsedInput  * fraction);
        st.outputTokens  += Math.round(tokensUsedOutput * fraction);
      }

      totalEnriched += enriched;
      totalFailed   += failed;
    }
  }

  // ── Update each affected ScrapingSession with accurate cumulative stats ────
  // We update the real session records — no separate tracking model needed.
  // Each session gets its own enrichment results added to what was already there.

  const updatedSessionIds = [];
  for (const [sid, totals] of sessionTotals) {
    try {
      const existing = await prisma.scrapingSession.findUnique({
        where:  { id: sid },
        select: {
          enrichedCount:         true,
          enrichmentFailedCount: true,
          aiInputTokens:         true,
          aiOutputTokens:        true,
        },
      });

      if (!existing) continue;

      // Re-compute keyword coverage for this specific session now that new
      // articles have been enriched
      const { keywordsWithContent, keywordsWithoutContent } =
        await buildKeywordCoverageReport(sid);

      await prisma.scrapingSession.update({
        where: { id: sid },
        data: {
          enrichedCount:         (existing.enrichedCount         || 0) + totals.enriched,
          enrichmentFailedCount: (existing.enrichmentFailedCount || 0) + totals.failed,
          aiInputTokens:         (existing.aiInputTokens         || 0) + totals.inputTokens,
          aiOutputTokens:        (existing.aiOutputTokens        || 0) + totals.outputTokens,
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

  // ── Build combined coverage report for the email ──────────────────────────
  // When enriching a single session, report its coverage.
  // When enriching across sessions, use the most recently started session.
  const reportSessionId = sessionId || (updatedSessionIds[0] ?? null);

  let keywordsWithContent    = [];
  let keywordsWithoutContent = [];
  if (reportSessionId) {
    ({ keywordsWithContent, keywordsWithoutContent } =
      await buildKeywordCoverageReport(reportSessionId));
  }

  // ── Send completion email (controlled by sendEmail option) ────────────────
  // Only sent if SEND_MANUAL_ENRICHMENT_EMAIL env var is not "false" AND
  // the sendEmail parameter is true (default).
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
        const report = {
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
            estimatedCostUSD: 0,
          },
          criticalErrors:      false,
          isManualEnrichment:  true,
          sessionsUpdated:     updatedSessionIds,  // extra context for the email
        };

        await sendCompletionNotification(report);
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
    enrichedCount:    totalEnriched,
    enrichmentFailed: totalFailed,
    sessionsUpdated:  updatedSessionIds,
    keywordsWithContent,
    keywordsWithoutContent,
    tokenUsage: {
      inputTokens:      tokenTracker.inputTokens,
      outputTokens:     tokenTracker.outputTokens,
      estimatedCostUSD: parseFloat(
        ((tokenTracker.inputTokens * 0.00000015) + (tokenTracker.outputTokens * 0.0000006)).toFixed(4)
      ),
    },
  };
}

module.exports = { runEnrichmentStage, runManualEnrichment };