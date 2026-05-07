/**
 * ai.sidebar.service.js
 *
 * Provides data for the AI generator's Insights sidebar:
 *   - getTrendingKeywords — most-used keywords from recent generations
 *   - getTopAIArticles   — top published AI-assisted articles by trendingScore
 */

const prisma = require("../config/prisma");

// ── Constants ─────────────────────────────────────────────────────────────────

const TOP_AI_ARTICLES_LIMIT = 3;

const TRENDING_INITIAL_BATCH  = 20;  // logs to check first
const TRENDING_EXPANSION_STEP = 5;   // logs added per expansion round
const TRENDING_SAFETY_CAP     = 200; // never scan more than this many logs
const TRENDING_MIN_RETURN     = 5;
const TRENDING_MAX_RETURN     = 7;

// ── getTrendingKeywords ────────────────────────────────────────────────────────
//
// Expands the pool of recent logs until at least one keyword appears more than
// once, or until the safety cap is reached. Returns 5-7 keywords ranked by
// frequency (tiebroken by recency).

async function getTrendingKeywords() {
  let poolSize  = TRENDING_INITIAL_BATCH;
  let pool      = [];
  let counts    = {};
  let hasRepeat = false;

  while (poolSize <= TRENDING_SAFETY_CAP) {
    pool = await prisma.ai_article_logs.findMany({
      where:   { deletedAt: null },
      orderBy: { generatedAt: "desc" },
      take:    poolSize,
      select:  { keywordsSelected: true },
    });

    counts    = {};
    hasRepeat = false;

    pool.forEach((log, position) => {
      for (const keyword of (log.keywordsSelected || [])) {
        if (!keyword) continue;
        if (!counts[keyword]) counts[keyword] = { frequency: 0, earliestPosition: position };
        counts[keyword].frequency += 1;
        if (position < counts[keyword].earliestPosition) {
          counts[keyword].earliestPosition = position;
        }
        if (counts[keyword].frequency > 1) hasRepeat = true;
      }
    });

    if (hasRepeat || pool.length < poolSize) break;
    poolSize += TRENDING_EXPANSION_STEP;
  }

  // Rank: frequency desc, then recency (smallest position = most recent)
  const ranked = Object.entries(counts)
    .map(([keyword, stats]) => ({ keyword, ...stats }))
    .sort((a, b) =>
      b.frequency !== a.frequency
        ? b.frequency - a.frequency
        : a.earliestPosition - b.earliestPosition
    );

  const repeated  = ranked.filter((k) => k.frequency > 1);
  const singleUse = ranked.filter((k) => k.frequency === 1);

  let result = repeated.slice(0, TRENDING_MAX_RETURN);

  if (result.length < TRENDING_MIN_RETURN) {
    const needed     = TRENDING_MIN_RETURN - result.length;
    const supplement = singleUse
      .sort((a, b) => a.earliestPosition - b.earliestPosition)
      .slice(0, needed);
    result = [...result, ...supplement];
  }

  console.log(
    `[AI][Trending] Pool: ${pool.length} logs | ` +
    `Unique keywords: ${ranked.length} | ` +
    `With repeats: ${repeated.length} | ` +
    `Returning: ${result.length}`
  );

  return result.map((k) => ({
    keyword:        k.keyword,
    usageCount:     k.frequency,
    mostRecentRank: k.earliestPosition,
  }));
}

// ── getTopAIArticles ───────────────────────────────────────────────────────────

async function getTopAIArticles() {
  return prisma.article.findMany({
    where:   { isAiGenerated: true, status: "PUBLISHED" },
    orderBy: { trendingScore: "desc" },
    take:    TOP_AI_ARTICLES_LIMIT,
    select:  {
      id:    true,
      title: true,
      author: { select: { displayName: true } },
    },
  });
}

module.exports = {
  getTrendingKeywords,
  getTopAIArticles,
};
