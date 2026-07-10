// @ts-nocheck
/**
 * ai.generation.service.js
 *
 * Handles the AI generation pipeline:
 *   - Session cache (short-lived in-memory store keyed by sessionId)
 *   - AI client + model fallback chain
 *   - analyzePrompt — extract topic + keywords from raw user input
 *   - generateArticle / regenerateArticle — produce + persist article logs
 */

const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");
const KEYWORD_LIST = require("../config/keywords");
const prisma = require("../config/prisma");

// ── Constants ─────────────────────────────────────────────────────────────────

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR   = 60 * MS_PER_MINUTE;
const MS_PER_DAY    = 24 * MS_PER_HOUR;

// Session cache
const SESSION_CACHE_TTL_MS       = 2 * MS_PER_HOUR;
const SESSION_CLEANUP_INTERVAL_MS = 30 * MS_PER_MINUTE;

// AI response
const MAX_KEYWORDS_SELECTED = 10;

// Hash helper
const HASH_SHIFT_AMOUNT = 5;
const HASH_TO_INT32     = 0; // used as `hash |= HASH_TO_INT32` — converts to 32-bit int

// Reference content
const REFERENCE_ARTICLES_PER_KEYWORD        = 2;
const REFERENCE_POOL_SIZE                   = 20;
const REFERENCE_KEYWORD_OFFSET_MULTIPLIER   = 7;

// Summary excerpt length when saving/loading to the articles table
const SUMMARY_EXCERPT_LENGTH = 200;

// AI model fallback chain (tried in order; first success wins)
const MODELS = [
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "tencent/hy3:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const LENGTH_CONFIG = {
  short:        { min: 300,  max: 1000, label: "300 to 1000 words"   },
  "mid-length": { min: 1000, max: 2000, label: "1000 to 2000 words"  },
  long:         { min: 2000, max: 9999, label: "at least 2000 words" },
};

// ── AI client ──────────────────────────────────────────────────────────────────

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey:  process.env.OPENROUTER_API_KEY,
});

// ── Session cache ──────────────────────────────────────────────────────────────

const sessionCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessionCache.entries()) {
    if (now - s.createdAt > SESSION_CACHE_TTL_MS) sessionCache.delete(id);
  }
}, SESSION_CLEANUP_INTERVAL_MS);

// ── AI helpers ─────────────────────────────────────────────────────────────────

async function callAI(messages) {
  for (const model of MODELS) {
    try {
      const completion = await client.chat.completions.create({ model, messages });
      const content    = completion.choices[0].message.content;
      const usage      = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
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

// ── Reference content ──────────────────────────────────────────────────────────
//
// Fetches enriched scraped summaries for the selected keywords and passes them
// to the AI model as background context.
//
// ROTATION METHOD — user-specific, day-based:
//   Each user gets a different set of reference articles even when selecting
//   the same keyword on the same day. The offset is derived from:
//     dayOfYear + hash(authorId) + keyword position

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << HASH_SHIFT_AMOUNT) - hash) + str.charCodeAt(i);
    hash |= HASH_TO_INT32; // convert to 32-bit int
  }
  return Math.abs(hash);
}

async function fetchReferenceContent(selectedKeywords, authorId) {
  if (!selectedKeywords || selectedKeywords.length === 0) return [];

  const today     = new Date();
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / MS_PER_DAY
  );
  const userOffset = authorId ? simpleHash(authorId) : 0;

  const referenceItems = [];

  for (const keyword of selectedKeywords) {
    const articles = await prisma.scrapedArticle.findMany({
      where:   { matchedKeywords: { has: keyword }, summary: { not: null } },
      orderBy: { scrapedAt: "desc" },
      select:  { id: true, title: true, summary: true },
      take:    REFERENCE_POOL_SIZE,
    });

    if (articles.length === 0) {
      console.log(`[AI][Reference] keyword="${keyword}" → 0 scraped summaries found`);
      continue;
    }

    const keywordPos    = selectedKeywords.indexOf(keyword);
    const finalOffset   = (dayOfYear + userOffset + keywordPos * REFERENCE_KEYWORD_OFFSET_MULTIPLIER) % articles.length;
    let fetchedForKeyword = 0;

    for (let i = 0; i < REFERENCE_ARTICLES_PER_KEYWORD; i++) {
      const article = articles[(finalOffset + i) % articles.length];
      if (article?.summary) {
        referenceItems.push({ keyword, title: article.title, summary: article.summary });
        fetchedForKeyword++;
      }
    }

    console.log(
      `[AI][Reference] keyword="${keyword}" → ${fetchedForKeyword}/${REFERENCE_ARTICLES_PER_KEYWORD} ` +
      `scraped summaries fetched (pool size: ${articles.length})`
    );
  }

  if (selectedKeywords.length > 0) {
    console.log(
      `[AI][Reference] Total reference summaries: ${referenceItems.length}/` +
      `${selectedKeywords.length * REFERENCE_ARTICLES_PER_KEYWORD} across ${selectedKeywords.length} keyword(s)`
    );
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

// ── Shared generation core ─────────────────────────────────────────────────────
//
// Both generateArticle and regenerateArticle share the same:
//   - session resolution, length/tone config, reference fetching
//   - AI call + word-count correction loop
//   - log persistence


async function _buildAndSaveArticle({
  sessionId,
  directInput,
  selectedKeywords,
  articleLength,
  tone,
  authorId,
  systemPrompt,
  userPromptPrefix,
  initialInputTokens  = 0,
  initialOutputTokens = 0,
}) {
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

  const referenceItems = await fetchReferenceContent(keywordsSelected, authorId);
  const referenceBlock = buildReferenceBlock(referenceItems);

  const buildMessages = (extra = "") => [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        `${userPromptPrefix}\n` +
        `Idea: "${userInput}"\n` +
        `Subtopics: ${subtopicsList}\n` +
        `Length: ${lengthConfig.label}\n` +
        `Tone: ${articleTone}\n` +
        `${extra}` +
        `${referenceBlock}\n\n` +
        `Respond ONLY with: {"title":"...","content":"..."}`,
    },
  ];

  let totalInputTokens  = initialInputTokens;
  let totalOutputTokens = initialOutputTokens;

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
        id:             uuidv4(),
        authorId,
        userPrompt:     userInput,
        keywordsPresented,
        keywordsSelected,
        articleLength:  storedLength,
        tone:           storedTone,
        articleTitle:   parsed.title,
        articleContent: parsed.content,
        wordCount,
        aiInputTokens:  totalInputTokens,
        aiOutputTokens: totalOutputTokens,
      },
    });
    logId = log.id;
  } catch (dbErr) {
    console.error("[AI] Failed to save to ai_article_logs:", dbErr.message);
  }

  return { title: parsed.title, content: parsed.content, wordCount, logId };
}

// ── analyzePrompt ──────────────────────────────────────────────────────────────

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
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, MAX_KEYWORDS_SELECTED) : [];

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

// ── generateArticle ────────────────────────────────────────────────────────────

async function generateArticle({ sessionId, userInput: directInput, selectedKeywords, articleLength, tone, authorId }) {
  const session = sessionId && sessionCache.has(sessionId) ? sessionCache.get(sessionId) : null;

  return _buildAndSaveArticle({
    sessionId,
    directInput,
    selectedKeywords,
    articleLength,
    tone,
    authorId,
    systemPrompt:
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
    userPromptPrefix:    "Write a blog article:",
    initialInputTokens:  session?.analyzeInputTokens  || 0,
    initialOutputTokens: session?.analyzeOutputTokens || 0,
  });
}

// ── regenerateArticle ──────────────────────────────────────────────────────────

async function regenerateArticle({ sessionId, userInput: directInput, selectedKeywords, articleLength, tone, authorId }) {
  return _buildAndSaveArticle({
    sessionId,
    directInput,
    selectedKeywords,
    articleLength,
    tone,
    authorId,
    systemPrompt:
      "You are an expert blog writer creating 100% original content. " +
      "Write a DIFFERENT version — new title, new angle, fresh structure.\n\n" +
      "PRIORITY ORDER:\n" +
      "1. USER'S IDEA — write about exactly what the user described\n" +
      "2. LENGTH and TONE — follow precisely\n" +
      "3. REFERENCE MATERIALS — use only if relevant, only for facts/ideas, NEVER copy wording\n\n" +
      "PLAGIARISM RULES: Write every sentence in your own voice. Never reproduce phrasing from references. " +
      "All content must be original. Respond with ONLY valid JSON.",
    userPromptPrefix:    "Write a FRESH, DIFFERENT article:",
    initialInputTokens:  0,
    initialOutputTokens: 0,
  });
}

module.exports = {
  sessionCache,
  analyzePrompt,
  generateArticle,
  regenerateArticle,
  SUMMARY_EXCERPT_LENGTH,
};
