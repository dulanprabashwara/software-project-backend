// src/services/enrichment.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3a — AI Enrichment Stage
//
// Runs AFTER the full scraping session completes.
// For every newly scraped article (summary=null), this service:
//   1. Groups articles by their broad category
//   2. Sends batches of 3 articles to a free AI model via OpenRouter
//   3. AI classifies each article to specific keywords (from categoryKeywords.js)
//      and writes a 130-150 word factual summary
//   4. Updates ScrapedArticle rows with summary + matchedKeywords[]
//   5. Tracks keyword coverage (which keywords got articles, which got none)
//   6. Tracks token usage for the session report
//
// WHY BATCH OF 3 (not 5):
//   Free models are less reliable with long complex outputs than paid models.
//   Batch of 3 keeps the output JSON small and predictable, reducing parse failures.
//   If a batch fails, only 3 articles are affected — fallback processes them 1 by 1.
//
// FREE MODELS USED (OpenRouter):
//   Primary:   google/gemini-2.0-flash-exp:free  — best free model for structured tasks
//   Fallback1: meta-llama/llama-3.3-70b-instruct:free — reliable instruction following
//   Fallback2: arcee-ai/trinity-large-preview:free — same as article generation
// ─────────────────────────────────────────────────────────────────────────────

const { OpenAI }          = require("openai");
const prisma              = require("../config/prisma");
const CATEGORY_KEYWORDS   = require("../config/categoryKeywords");

// ── OpenRouter Client ────────────────────────────────────────────────────────
// Same setup as ai.service.js — uses OPENROUTER_API_KEY from .env

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey:  process.env.OPENROUTER_API_KEY,
});

// Free model priority list — best for classification/structured JSON first
const ENRICHMENT_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "arcee-ai/trinity-large-preview:free",
];

const BATCH_SIZE = 3; // articles per AI call — kept small for free model reliability

// Delay between API calls (ms) — avoids hitting OpenRouter rate limits
const API_CALL_DELAY_MS = 1200;


// ── callOpenRouter ────────────────────────────────────────────────────────────
// Sends messages to OpenRouter, trying each free model in order.
// Returns the raw response text, or throws if all models fail.

async function callOpenRouter(messages, maxTokens = 900) {
  let lastError;

  for (const model of ENRICHMENT_MODELS) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages,
        max_tokens:  maxTokens,
        temperature: 0.1, // low = more predictable, consistent JSON output
      });

      const content = completion.choices[0]?.message?.content || "";
      const usage   = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };

      return { content, usage, model };

    } catch (err) {
      console.warn(`[Enrichment] Model "${model}" failed: ${err.message}`);
      lastError = err;
      await new Promise((r) => setTimeout(r, 500)); // small delay before trying next
    }
  }

  throw lastError || new Error("All enrichment models failed");
}

// ── parseEnrichmentResponse ───────────────────────────────────────────────────
// Robustly parses the AI response JSON.
// Handles markdown fences, extra whitespace, and common malformations.
// Returns parsed array or throws if completely unparseable.

function parseEnrichmentResponse(raw) {
  // Strip markdown code fences
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Sometimes models wrap the array in an object — unwrap if needed
  if (cleaned.startsWith("{")) {
    const match = cleaned.match(/"(?:results?|articles?|data)"\s*:\s*(\[[\s\S]*\])/);
    if (match) cleaned = match[1];
  }

  // Find the JSON array boundaries
  const start = cleaned.indexOf("[");
  const end   = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in response");

  cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Last resort: try to fix common JSON issues (trailing commas, unescaped chars)
    const fixed = cleaned
      .replace(/,\s*([}\]])/g, "$1")        // trailing commas
      .replace(/[\u0000-\u001F\u007F]/g, " ") // control chars
      .replace(/\n/g, "\\n");               // literal newlines in strings

    return JSON.parse(fixed);
  }
}

// ── buildBatchPrompt ──────────────────────────────────────────────────────────
// Builds the prompt for a batch of articles.
// Explicitly tells the model what to do and what NOT to do.
// The output format is a JSON array with one entry per article.

function buildBatchPrompt(articles, categoryKeywords) {
  const articlesText = articles.map((a, i) =>
    `--- ARTICLE ${i + 1} (ID: ${a.id}) ---\n` +
    `Title: ${a.title}\n\n` +
    // Truncate to ~10000 chars (~1500 words) — sufficient for classification
    // without sending unnecessary tokens for very long articles
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
// Processes one batch of up to BATCH_SIZE articles.
// If batch fails to parse, falls back to processing each article individually.
// Updates DB for each successfully processed article.
// Returns { enriched: number, failed: number } counts.

async function processBatch(articles, categoryKeywords, tokenTracker, sessionId, logScrapingEvent) {
  let enriched = 0;
  let failed   = 0;

  // ── Try batch processing ─────────────────────────────────────────────
  let results = null;

  try {
    const messages = buildBatchPrompt(articles, categoryKeywords);
    const { content, usage, model } = await callOpenRouter(messages, 900);

    // Track tokens (approximate — free models may not always return usage)
    tokenTracker.inputTokens  += usage.prompt_tokens  || 0;
    tokenTracker.outputTokens += usage.completion_tokens || 0;

    results = parseEnrichmentResponse(content);
    console.log(`[Enrichment] Batch of ${articles.length} classified via ${model}`);

  } catch (err) {
    console.warn(`[Enrichment] Batch failed (${err.message}) — falling back to single-article mode`);
    results = null;
  }

  // ── If batch succeeded, save results ────────────────────────────────
  if (results && Array.isArray(results)) {
    for (const result of results) {
      const article = articles.find((a) => a.id === result.id);
      if (!article) continue;

      const keywords = Array.isArray(result.matchedKeywords) ? result.matchedKeywords.slice(0, 6) : [];
      const summary  = typeof result.summary === "string" && result.summary.trim().length > 50
        ? result.summary.trim()
        : null;

      try {
        await prisma.scrapedArticle.update({
          where: { id: article.id },
          data: {
            summary:         summary,
            matchedKeywords: keywords,
          },
        });

        await logScrapingEvent(sessionId, {
          logType:  "enrichment_success",
          url:      article.sourceUrl,
          category: article.category,
          details:  { matchedKeywords: keywords, summaryLength: summary?.length || 0 },
        });

        enriched++;
      } catch (dbErr) {
        console.error(`[Enrichment] DB update failed for ${article.id}: ${dbErr.message}`);
        failed++;
      }
    }

    return { enriched, failed };
  }

  // ── Fallback: process each article individually ───────────────────────
  for (const article of articles) {
    await new Promise((r) => setTimeout(r, API_CALL_DELAY_MS));

    try {
      const messages = buildBatchPrompt([article], categoryKeywords);
      const { content, usage, model } = await callOpenRouter(messages, 400);

      tokenTracker.inputTokens  += usage.prompt_tokens     || 0;
      tokenTracker.outputTokens += usage.completion_tokens || 0;

      const results = parseEnrichmentResponse(content);
      const result  = Array.isArray(results) ? results[0] : null;

      if (!result) throw new Error("Empty result from single-article enrichment");

      const keywords = Array.isArray(result.matchedKeywords) ? result.matchedKeywords.slice(0, 6) : [];
      const summary  = typeof result.summary === "string" && result.summary.trim().length > 50
        ? result.summary.trim()
        : null;

      await prisma.scrapedArticle.update({
        where: { id: article.id },
        data: { summary, matchedKeywords: keywords },
      });

      await logScrapingEvent(sessionId, {
        logType:  "enrichment_success",
        url:      article.sourceUrl,
        category: article.category,
        details:  { matchedKeywords: keywords, model, fallback: true },
      });

      enriched++;
      console.log(`[Enrichment] ✅ (fallback) "${article.title}" → [${keywords.join(", ")}]`);

    } catch (err) {
      console.error(`[Enrichment] ❌ Failed: "${article.title}" — ${err.message}`);
      await logScrapingEvent(sessionId, {
        logType:  "enrichment_failure",
        url:      article.sourceUrl,
        category: article.category,
        reason:   err.message,
      });
      failed++;
    }
  }

  return { enriched, failed };
}


// ── runEnrichmentStage ────────────────────────────────────────────────────────
// Main entry point. Called from scraper.service.js after Phase 2 completes.
//
// Flow:
//   For each category → fetch unenriched articles from this session
//     → batch into groups of BATCH_SIZE
//     → call AI → update DB
//   → calculate keyword coverage (which keywords got content, which got none)
//   → return enrichment stats for session report

async function runEnrichmentStage(sessionId) {
  // Lazy-require to avoid circular dependency with scraper.service.js
  const { logScrapingEvent } = await import("./scraper.service.js").catch(() => ({
    logScrapingEvent: async () => {},
  }));

  // Build a standalone log function that uses prisma directly (avoids import issues)
  const log = async (logType, url, category, reason, details) => {
    await prisma.scrapingLog.create({
      data: { sessionId, logType, url: url || "", category: category || null, reason: reason || null, details: details || null },
    }).catch(() => {});
  };

  console.log("\n[Enrichment] ═══ Phase 3a: AI Enrichment Stage Starting ═══");

  const tokenTracker = { inputTokens: 0, outputTokens: 0 };

  // keyword coverage tracker — counts how many articles matched each keyword
  const keywordCoverage = {};
  for (const keywords of Object.values(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (!(kw in keywordCoverage)) keywordCoverage[kw] = 0;
    }
  }

  let totalEnriched = 0;
  let totalFailed   = 0;

  const categories = Object.keys(CATEGORY_KEYWORDS);

  for (const category of categories) {
    const categoryKeywords = CATEGORY_KEYWORDS[category];

    // Fetch articles from this session that haven't been enriched yet
    const articles = await prisma.scrapedArticle.findMany({
      where: {
        sessionId,
        category,
        summary: null, // not yet enriched
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

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[Enrichment] "${category}" batch ${batchNum}: ${batch.length} articles`);

      // Delay between batches to respect rate limits
      if (i > 0) await new Promise((r) => setTimeout(r, API_CALL_DELAY_MS));

      const { enriched, failed } = await processBatch(batch, categoryKeywords, tokenTracker, sessionId, log);
      totalEnriched += enriched;
      totalFailed   += failed;
    }

    // After enrichment for this category, fetch updated matchedKeywords
    // to build the keyword coverage report
    const enrichedArticles = await prisma.scrapedArticle.findMany({
      where:  { sessionId, category, matchedKeywords: { isEmpty: false } },
      select: { matchedKeywords: true },
    });

    for (const art of enrichedArticles) {
      for (const kw of art.matchedKeywords) {
        if (kw in keywordCoverage) keywordCoverage[kw]++;
      }
    }
  }

  // Build keyword coverage summary
  const keywordsWithContent    = Object.entries(keywordCoverage)
    .filter(([, count]) => count > 0)
    .map(([keyword, count]) => ({ keyword, articleCount: count }))
    .sort((a, b) => b.articleCount - a.articleCount);

  const keywordsWithoutContent = Object.entries(keywordCoverage)
    .filter(([, count]) => count === 0)
    .map(([keyword]) => keyword);

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
      // Note: free models — no monetary cost. Tracked for monitoring purposes.
      // When upgraded to GPT-4o-mini: cost = (input × $0.00000015) + (output × $0.0000006)
      estimatedCostUSD: parseFloat(
        ((tokenTracker.inputTokens * 0.00000015) + (tokenTracker.outputTokens * 0.0000006)).toFixed(4)
      ),
    },
  };
}

module.exports = { runEnrichmentStage };
