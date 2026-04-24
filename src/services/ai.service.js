const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");
const KEYWORD_LIST = require("../config/keywords");
const prisma = require("../config/prisma");
const { generateUniqueSlug, calculateReadingTime } = require("../utils/helpers");

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey:  process.env.OPENROUTER_API_KEY,
});

const MODELS = [
  "openai/gpt-oss-120b:free",
  "google/gemma-4-31b-it:free",
  "arcee-ai/trinity-large-preview:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const LENGTH_CONFIG = {
  short:        { min: 300,  max: 1000,  label: "300 to 1000 words"  },
  "mid-length": { min: 1000, max: 2000,  label: "1000 to 2000 words" },
  long:         { min: 2000, max: 9999,  label: "at least 2000 words" },
};

// ─── Session Cache ─────────────────────────────────────────────────────────────
const sessionCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessionCache.entries()) {
    if (now - s.createdAt > 2 * 60 * 60 * 1000) sessionCache.delete(id);
  }
}, 30 * 60 * 1000);

// ─── AI helpers ───────────────────────────────────────────────────────────────

async function callAI(messages) {
  for (const model of MODELS) {
    try {
      const completion = await client.chat.completions.create({ model, messages });
      const content = completion.choices[0].message.content;
      const usage   = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
      return { content, usage };
    } catch (err) {
      console.warn(`[AI] Model ${model} failed: ${err.message}`);
    }
  }
  throw new Error("All AI models failed. Check your OPENROUTER_API_KEY.");
}

function parseAIJson(raw) {
  let cleaned = raw.replace(/```json|```/g, "").trim();
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F]/g, (char) => {
    const escapes = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
    return escapes[char] || "";
  });
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const titleMatch   = raw.match(/"title"\s*:\s*"([^"]+)"/);
    const contentMatch = raw.match(/"content"\s*:\s*"([\s\S]+?)"\s*}/);
    if (titleMatch && contentMatch) {
      return { title: titleMatch[1], content: contentMatch[1].replace(/\\n/g, "\n") };
    }
    throw new Error(`AI returned unparseable response: ${e.message}`);
  }
}

function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// ─── SCRAPER REFERENCE CONTENT ────────────────────────────────────────────────
// Fetches enriched scraped summaries for the keywords the user selected.
// These are sent to the AI as optional reference material.
//
// ROTATION METHOD — user-specific, day-based:
//   Each user gets a different set of reference articles even if they select
//   the same keyword on the same day. The offset is calculated from:
//     dayOfYear + hash of authorId + keyword position
//
//   This means:
//   - Two users selecting the same keyword on the same day get DIFFERENT articles
//   - The same user gets different articles on different days
//   - All scraped summaries for a keyword are cycled through over time
//   - No randomness — the selection is deterministic and repeatable

const REFERENCE_ARTICLES_PER_KEYWORD = 2;

// Simple numeric hash of a string — used to make per-user offset
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // convert to 32-bit int
  }
  return Math.abs(hash);
}

async function fetchReferenceContent(selectedKeywords, authorId) {
  if (!selectedKeywords || selectedKeywords.length === 0) return [];

  const today     = new Date();
  const dayOfYear = Math.floor(
    (today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)
  );

  // Per-user offset — different user ID produces a different base offset
  const userOffset = authorId ? simpleHash(authorId) : 0;

  const referenceItems = [];

  for (const keyword of selectedKeywords) {
    const articles = await prisma.scrapedArticle.findMany({
      where: {
        matchedKeywords: { has: keyword },
        summary:         { not: null },
      },
      orderBy: { scrapedAt: "desc" },
      select:  { id: true, title: true, summary: true },
      take:    20,
    });

    if (articles.length === 0) {
      console.log(`[AI][Reference] keyword="${keyword}" → 0 scraped summaries found (no enriched articles for this keyword)`);
      continue;
    }

    // Combine day, user hash, and keyword position for the final offset
    const keywordPos  = selectedKeywords.indexOf(keyword);
    const finalOffset = (dayOfYear + userOffset + keywordPos * 7) % articles.length;
   
    let fetchedForKeyword = 0;
    for (let i = 0; i < REFERENCE_ARTICLES_PER_KEYWORD; i++) {
      const idx     = (finalOffset + i) % articles.length;
      const article = articles[idx];
      if (article?.summary) {
        referenceItems.push({ keyword, title: article.title, summary: article.summary });
    fetchedForKeyword++;      
      }
    } 
     console.log(`[AI][Reference] keyword="${keyword}" → ${fetchedForKeyword}/${REFERENCE_ARTICLES_PER_KEYWORD} scraped summaries fetched (pool size: ${articles.length})`);
  }

  // Summary line covering all keywords at once
  if (selectedKeywords.length > 0) {
    const totalFetched = referenceItems.length;
    const maxPossible  = selectedKeywords.length * REFERENCE_ARTICLES_PER_KEYWORD;
    console.log(`[AI][Reference] Total reference summaries: ${totalFetched}/${maxPossible} across ${selectedKeywords.length} keyword(s)`);
  }
  
  return referenceItems;
}

function buildReferenceBlock(referenceItems) {
  if (referenceItems.length === 0) return "";

  const lines = referenceItems.map((item, i) =>
    `[REF ${i + 1}] Topic: ${item.keyword}\nTitle: ${item.title}\nSummary: ${item.summary}`
  );

  return (
    `\n\nREFERENCE MATERIALS (background context from current web content):\n` +
    `IMPORTANT RULES for using these references:\n` +
    `- The user's idea, tone, and length instructions come FIRST — always\n` +
    `- Only use a reference if it is clearly relevant to the user's topic\n` +
    `- Use references for IDEAS and FACTS only — never copy wording\n` +
    `- Rewrite every piece of information entirely in your own words\n` +
    `- Do not follow the structure or paragraph order of any reference\n` +
    `- The final article must read as fully original writing, not a summary of these sources\n\n` +
    lines.join("\n\n")
  );
}

// ─── ANALYZE ──────────────────────────────────────────────────────────────────

async function analyzePrompt(userInput) {
  const messages = [
    {
      role: "system",
      content: "You are an assistant for a blogging platform. Respond with ONLY valid JSON. No markdown, no extra text.",
    },
    {
      role: "user",
      content:
        `Analyze this blog article idea: "${userInput}"\n\n` +
        `KEYWORD LIST (only select from this list exactly):\n${KEYWORD_LIST.join(", ")}\n\n` +
        `Tasks:\n` +
        `1. Identify main topic\n` +
        `2. Select 5-10 matching keywords from the list only\n` +
        `3. Detect if prompt mentions article LENGTH (short/long/word count etc)\n` +
        `4. Detect if prompt mentions TONE (professional/casual/humorous etc)\n\n` +
        `Respond ONLY with:\n` +
        `{"topic":"...","keywords":[...],"hasArticleLengthInPrompt":false,"hasToneInPrompt":false}`,
    },
  ];

  const { content: raw, usage } = await callAI(messages);
  const parsed   = parseAIJson(raw);
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 10) : [];

  const sessionId = uuidv4();
  sessionCache.set(sessionId, {
    userInput,
    keywordsPresented:   keywords,
    hasLengthInPrompt:   Boolean(parsed.hasArticleLengthInPrompt),
    hasToneInPrompt:     Boolean(parsed.hasToneInPrompt),
    createdAt:           Date.now(),
    analyzeInputTokens:  usage.prompt_tokens     || 0,
    analyzeOutputTokens: usage.completion_tokens || 0,
  });

  return {
    sessionId,
    topic:                    parsed.topic || "",
    keywords,
    hasArticleLengthInPrompt: Boolean(parsed.hasArticleLengthInPrompt),
    hasToneInPrompt:          Boolean(parsed.hasToneInPrompt),
  };
}

// ─── GENERATE ─────────────────────────────────────────────────────────────────

async function generateArticle({ sessionId, userInput: directInput, selectedKeywords, articleLength, tone, authorId }) {
  const session   = sessionId && sessionCache.has(sessionId) ? sessionCache.get(sessionId) : null;
  const userInput = session?.userInput ?? directInput;
  if (!userInput?.trim()) throw new Error("No prompt available. Please start over.");

  const storedLength      = session?.hasLengthInPrompt ? null : (articleLength || "short");
  const storedTone        = session?.hasToneInPrompt   ? null : (tone || "professional");
  const keywordsPresented = session?.keywordsPresented ?? [];
  const keywordsSelected  = selectedKeywords ?? [];
  const lengthConfig      = LENGTH_CONFIG[articleLength] || LENGTH_CONFIG.short;
  const articleTone       = tone || "professional";
  const subtopicsList     = keywordsSelected.length
    ? keywordsSelected.join(", ")
    : "none — generate based on user prompt alone";

  // Fetch per-user rotated reference content
  const referenceItems = await fetchReferenceContent(keywordsSelected, authorId);
  const referenceBlock = buildReferenceBlock(referenceItems);

  const buildMessages = (extra = "") => [
    {
      role: "system",
      content:
        "You are an expert blog writer creating 100% original content.\n\n" +
        "PRIORITY ORDER (follow strictly):\n" +
        "1. USER'S IDEA — write about exactly what the user described\n" +
        "2. LENGTH and TONE instructions — follow precisely\n" +
        "3. REFERENCE MATERIALS — use only if relevant, only for facts/ideas, NEVER copy wording\n\n" +
        "PLAGIARISM RULES (non-negotiable):\n" +
        "- Write every sentence in your own unique voice\n" +
        "- Never reproduce phrases or sentence structures from reference materials\n" +
        "- Do not follow the structure of any reference article\n" +
        "- All statistics, claims, and ideas from references must be rewritten completely\n" +
        "- The article must pass plagiarism checks — it must read as original writing\n\n" +
        "Respond with ONLY valid JSON. No markdown, no extra text.",
    },
    {
      role: "user",
      content:
        `Write a blog article:\n` +
        `Idea: "${userInput}"\n` +
        `Subtopics: ${subtopicsList}\n` +
        `Length: ${lengthConfig.label}\n` +
        `Tone: ${articleTone}\n` +
        `${extra}` +
        `${referenceBlock}\n\n` +
        `Respond ONLY with: {"title":"...","content":"..."}`,
    },
  ];

  let totalInputTokens  = session?.analyzeInputTokens  || 0;
  let totalOutputTokens = session?.analyzeOutputTokens || 0;

  const { content: raw, usage: u1 } = await callAI(buildMessages());
  totalInputTokens  += u1.prompt_tokens     || 0;
  totalOutputTokens += u1.completion_tokens || 0;

  let parsed    = parseAIJson(raw);
  let wordCount = countWords(parsed.content);

  if (wordCount < lengthConfig.min || (articleLength !== "long" && wordCount > lengthConfig.max)) {
    const correction = wordCount < lengthConfig.min
      ? `IMPORTANT: Too short (${wordCount} words). Must be at least ${lengthConfig.min} words.\n`
      : `IMPORTANT: Too long (${wordCount} words). Must be under ${lengthConfig.max} words.\n`;
    const { content: raw2, usage: u2 } = await callAI(buildMessages(correction));
    totalInputTokens  += u2.prompt_tokens     || 0;
    totalOutputTokens += u2.completion_tokens || 0;
    parsed    = parseAIJson(raw2);
    wordCount = countWords(parsed.content);
  }

  let logId = null;
  try {
    const log = await prisma.ai_article_logs.create({
      data: {
        id:                uuidv4(),
        authorId,
        userPrompt:        userInput,
        keywordsPresented,
        keywordsSelected,
        articleLength:     storedLength,
        tone:              storedTone,
        articleTitle:      parsed.title,
        articleContent:    parsed.content,
        wordCount,
        aiInputTokens:     totalInputTokens,
        aiOutputTokens:    totalOutputTokens,
      },
    });
    logId = log.id;
  } catch (dbErr) {
    console.error("[AI] Failed to save to ai_article_logs:", dbErr.message);
  }

  return { title: parsed.title, content: parsed.content, wordCount, logId };
}

// ─── REGENERATE ───────────────────────────────────────────────────────────────

async function regenerateArticle({ sessionId, userInput: directInput, selectedKeywords, articleLength, tone, authorId }) {
  const session   = sessionId && sessionCache.has(sessionId) ? sessionCache.get(sessionId) : null;
  const userInput = session?.userInput ?? directInput;
  if (!userInput?.trim()) throw new Error("No prompt available. Please start over.");

  const storedLength      = session?.hasLengthInPrompt ? null : (articleLength || "short");
  const storedTone        = session?.hasToneInPrompt   ? null : (tone || "professional");
  const keywordsPresented = session?.keywordsPresented ?? [];
  const keywordsSelected  = selectedKeywords ?? [];
  const lengthConfig      = LENGTH_CONFIG[articleLength] || LENGTH_CONFIG.short;
  const articleTone       = tone || "professional";
  const subtopicsList     = keywordsSelected.length ? keywordsSelected.join(", ") : "none";

  const referenceItems = await fetchReferenceContent(keywordsSelected, authorId);
  const referenceBlock = buildReferenceBlock(referenceItems);

  const buildMessages = (extra = "") => [
    {
      role: "system",
      content:
        "You are an expert blog writer creating 100% original content. Write a DIFFERENT version — new title, new angle, fresh structure.\n\n" +
        "PRIORITY ORDER:\n" +
        "1. USER'S IDEA — write about exactly what the user described\n" +
        "2. LENGTH and TONE — follow precisely\n" +
        "3. REFERENCE MATERIALS — use only if relevant, only for facts/ideas, NEVER copy wording\n\n" +
        "PLAGIARISM RULES: Write every sentence in your own voice. Never reproduce phrasing from references. " +
        "All content must be original. Respond with ONLY valid JSON.",
    },
    {
      role: "user",
      content:
        `Write a FRESH, DIFFERENT article:\n` +
        `Idea: "${userInput}"\n` +
        `Subtopics: ${subtopicsList}\n` +
        `Length: ${lengthConfig.label}\n` +
        `Tone: ${articleTone}\n` +
        `${extra}` +
        `${referenceBlock}\n\n` +
        `Respond ONLY with: {"title":"...","content":"..."}`,
    },
  ];

  let totalInputTokens  = 0;
  let totalOutputTokens = 0;

  const { content: raw, usage: u1 } = await callAI(buildMessages());
  totalInputTokens  += u1.prompt_tokens     || 0;
  totalOutputTokens += u1.completion_tokens || 0;

  let parsed    = parseAIJson(raw);
  let wordCount = countWords(parsed.content);

  if (wordCount < lengthConfig.min || (articleLength !== "long" && wordCount > lengthConfig.max)) {
    const correction = wordCount < lengthConfig.min
      ? `Too short (${wordCount}w). Expand to ${lengthConfig.min}+.\n`
      : `Too long (${wordCount}w). Cut to under ${lengthConfig.max}.\n`;
    const { content: raw2, usage: u2 } = await callAI(buildMessages(correction));
    totalInputTokens  += u2.prompt_tokens     || 0;
    totalOutputTokens += u2.completion_tokens || 0;
    parsed    = parseAIJson(raw2);
    wordCount = countWords(parsed.content);
  }

  let logId = null;
  try {
    const log = await prisma.ai_article_logs.create({
      data: {
        id:                uuidv4(),
        authorId,
        userPrompt:        userInput,
        keywordsPresented,
        keywordsSelected,
        articleLength:     storedLength,
        tone:              storedTone,
        articleTitle:      parsed.title,
        articleContent:    parsed.content,
        wordCount,
        aiInputTokens:     totalInputTokens,
        aiOutputTokens:    totalOutputTokens,
      },
    });
    logId = log.id;
  } catch (dbErr) {
    console.error("[AI] Failed to save regeneration to ai_article_logs:", dbErr.message);
  }

  return { title: parsed.title, content: parsed.content, wordCount, logId };
}

// ─── SAVE DRAFT ───────────────────────────────────────────────────────────────

async function saveDraft({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found. It may have expired. Please regenerate.");
  if (log.authorId && log.authorId !== authorId) throw new Error("You can only save your own articles.");

  if (log.linkedArticleId) {
    const existingArticle = await prisma.article.findUnique({
      where:   { id: log.linkedArticleId },
      include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
    if (existingArticle?.status === "EDITING") {
      const draft = await prisma.article.update({
        where:   { id: existingArticle.id },
        data:    { status: "DRAFT" },
        include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      });
      return { draft, alreadySaved: false };
    }
    return { draft: existingArticle, alreadySaved: true };
  }

  const slug        = await generateUniqueSlug(log.articleTitle);
  const readingTime = calculateReadingTime(log.articleContent);

  const draft = await prisma.article.create({
    data: {
      title:         log.articleTitle,
      slug,
      content:       log.articleContent,
      summary:       log.articleContent.slice(0, 200).replace(/\n/g, " ") + "...",
      status:        "DRAFT",
      isAiGenerated: true,
      readingTime,
      tags:          [],
      authorId,
    },
    include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
  });

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { linkedArticleId: draft.id },
  });

  return { draft, alreadySaved: false };
}

// ─── LOAD TO EDITOR ───────────────────────────────────────────────────────────

async function loadToEditor({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found.");
  if (log.authorId && log.authorId !== authorId) throw new Error("You can only edit your own articles.");

  if (log.linkedArticleId) {
    const article = await prisma.article.update({
      where: { id: log.linkedArticleId },
      data:  { status: "EDITING", updatedAt: new Date() },
    });
    return { articleId: article.id };
  }

  const slug        = await generateUniqueSlug(log.articleTitle);
  const readingTime = calculateReadingTime(log.articleContent);

  const article = await prisma.article.create({
    data: {
      title:         log.articleTitle,
      slug,
      content:       log.articleContent,
      summary:       log.articleContent.slice(0, 200).replace(/\n/g, " ") + "...",
      status:        "EDITING",
      isAiGenerated: true,
      readingTime,
      tags:          [],
      coverImage:    null,
      authorId,
    },
  });

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { linkedArticleId: article.id },
  });

  return { articleId: article.id };
}

// ─── SOFT DELETE LOG ──────────────────────────────────────────────────────────
// Sets deletedAt = now(). The article disappears from the list immediately.
// It can be restored within 1 hour. After that it is permanently deleted
// by the cleanup that runs at the start of every getArticleLogs call.

async function softDeleteLog({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article not found.");
  if (log.authorId !== authorId) throw new Error("You can only delete your own articles.");

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { deletedAt: new Date() },
  });
}

// ─── RESTORE LOG ──────────────────────────────────────────────────────────────
// Clears deletedAt so the article reappears in the list.
// Fails if more than 1 hour has passed (permanent cleanup may have run).

async function restoreLog({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article not found. It may have been permanently deleted.");
  if (log.authorId !== authorId) throw new Error("You can only restore your own articles.");
  if (!log.deletedAt) throw new Error("This article is not deleted.");

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (log.deletedAt < oneHourAgo) {
    throw new Error("Restore window has expired. This article has been permanently deleted.");
  }

  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { deletedAt: null },
  });
}

// ─── GET LOGS (list) ──────────────────────────────────────────────────────────
// First permanently deletes any soft-deleted entries older than 1 hour.
// Then returns only active (not soft-deleted) unsaved articles.

async function getArticleLogs(authorId) {
  // Permanent cleanup — delete entries that were soft-deleted more than 1 hour ago
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.ai_article_logs.deleteMany({
    where: {
      authorId,
      deletedAt: { not: null, lte: oneHourAgo },
    },
  }).catch((err) => console.error("[AI] Cleanup failed:", err.message));

  const logs = await prisma.ai_article_logs.findMany({
    where: {
      authorId,
      linkedArticleId: null,
      deletedAt:       null,  // exclude soft-deleted entries
    },
    orderBy: { generatedAt: "desc" },
    select: {
      id:             true,
      articleTitle:   true,
      generatedAt:    true,
      wordCount:      true,
      articleLength:  true,
      tone:           true,
      aiInputTokens:  true,
      aiOutputTokens: true,
    },
  });
  return logs;
}

// ─── GET LOG BY ID (detail) ───────────────────────────────────────────────────

async function getArticleLogById(id, authorId) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id } });
  if (!log) throw new Error("Article not found.");
  if (log.authorId && log.authorId !== authorId) throw new Error("You do not have permission to view this article.");
  return log;
}


// ─── GET TRENDING TOPICS ──────────────────────────────────────────────────────


const TRENDING_INITIAL_BATCH  = 20;  // logs to check first
const TRENDING_EXPANSION_STEP = 5;   // logs added per expansion round
const TRENDING_SAFETY_CAP     = 200; // never scan more than this many logs
const TRENDING_MIN_RETURN     = 5;
const TRENDING_MAX_RETURN     = 10;

async function getTrendingKeywords() {
  let poolSize = TRENDING_INITIAL_BATCH;
  let pool     = [];            // ordered newest → oldest (index 0 = most recent)
  let counts   = {};            // keyword → { frequency, earliestPosition }
  let hasRepeat = false;

  // ── Expand pool until we find at least one repeated keyword ───────────────
  while (poolSize <= TRENDING_SAFETY_CAP) {
    pool = await prisma.ai_article_logs.findMany({
      where:   { deletedAt: null },         // exclude soft-deleted logs
      orderBy: { generatedAt: "desc" },
      take:    poolSize,
      select:  { keywordsSelected: true },
    });

    // Build frequency + earliest-position map
    counts    = {};
    hasRepeat = false;

    pool.forEach((log, position) => {
      for (const keyword of (log.keywordsSelected || [])) {
        if (!keyword) continue;
        if (!counts[keyword]) {
          counts[keyword] = { frequency: 0, earliestPosition: position };
        }
        counts[keyword].frequency += 1;
        // earliestPosition = smallest index = most recent log this keyword appeared in
        if (position < counts[keyword].earliestPosition) {
          counts[keyword].earliestPosition = position;
        }
        if (counts[keyword].frequency > 1) hasRepeat = true;
      }
    });

    // Stop expanding once we have repeated keywords, or if the pool
    // returned fewer logs than requested (we have exhausted the table)
    if (hasRepeat || pool.length < poolSize) break;

    poolSize += TRENDING_EXPANSION_STEP;
  }

  // ── Rank all keywords ─────────────────────────────────────────────────────
  // Primary  : frequency descending
  // Tiebreak : earliestPosition ascending (lower index = more recent = better)
  const ranked = Object.entries(counts)
    .map(([keyword, stats]) => ({ keyword, ...stats }))
    .sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.earliestPosition - b.earliestPosition;
    });

  // ── Separate repeated from single-use keywords ────────────────────────────
  const repeated  = ranked.filter(k => k.frequency > 1);
  const singleUse = ranked.filter(k => k.frequency === 1);

  // ── Build return list: min 5, max 10 ─────────────────────────────────────
  let result = repeated.slice(0, TRENDING_MAX_RETURN);

  // If fewer than TRENDING_MIN_RETURN repeated keywords, supplement with
  // single-use keywords ordered by recency (smallest position first)
  if (result.length < TRENDING_MIN_RETURN) {
    const needed    = TRENDING_MIN_RETURN - result.length;
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

  return result.map(k => ({
    keyword:          k.keyword,
    usageCount:       k.frequency,
    mostRecentRank:   k.earliestPosition,
  }));
}
const getTopAIArticles = async () => {
  const articles = await prisma.article.findMany({
    where: {
      isAiGenerated: true,
      status: "PUBLISHED",   // only show publicly visible articles
    },
    orderBy: { trendingScore: "desc" },
    take: 5,
    select: {
      id:    true,
      title: true,
      author: {
        select: { displayName: true },
      },
    },
  });
  return articles;
};
// ─── Set User Response ────────────────────────────────────────────────────────

async function setUserResponse({ logId, authorId, response }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found.");
  if (log.authorId !== authorId) throw new Error("You can only react to your own articles.");
 
  // Toggle: clicking the same reaction again clears it
  const newValue = log.userResponse === response ? null : response;
 
  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { userResponse: newValue },
  });
 
  return newValue;
}
module.exports = {
  analyzePrompt,
  generateArticle,
  regenerateArticle,
  saveDraft,
  loadToEditor,
  softDeleteLog,
  restoreLog,
  getArticleLogs,
  getArticleLogById,
  getTrendingKeywords,
  getTopAIArticles,
  setUserResponse,
};