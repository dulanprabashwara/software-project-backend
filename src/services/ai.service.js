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
  "arcee-ai/trinity-large-preview:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const LENGTH_CONFIG = {
  short:        { min: 300,  max: 1000,  label: "300 to 1000 words"  },
  "mid-length": { min: 1000, max: 2000,  label: "1000 to 2000 words" },
  long:         { min: 2000, max: 9999,  label: "at least 2000 words" },
};

const sessionCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessionCache.entries()) {
    if (now - s.createdAt > 2 * 60 * 60 * 1000) sessionCache.delete(id);
  }
}, 30 * 60 * 1000);

async function callAI(messages) {
  for (const model of MODELS) {
    try {
      const completion = await client.chat.completions.create({ model, messages });
      return completion.choices[0].message.content;
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

  const raw      = await callAI(messages);
  const parsed   = parseAIJson(raw);
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 10) : [];

  const sessionId = uuidv4();
  sessionCache.set(sessionId, {
    userInput,
    keywordsPresented:  keywords,
    hasLengthInPrompt:  Boolean(parsed.hasArticleLengthInPrompt),
    hasToneInPrompt:    Boolean(parsed.hasToneInPrompt),
    createdAt:          Date.now(),
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
  const subtopicsList     = keywordsSelected.length ? keywordsSelected.join(", ") : "none — generate based on user prompt alone";

  const buildMessages = (extra = "") => [
    { role: "system", content: "You are an expert blog writer. Respond with ONLY valid JSON. No markdown, no extra text." },
    { role: "user",   content: `Write a blog article:\nIdea: "${userInput}"\nSubtopics: ${subtopicsList}\nLength: ${lengthConfig.label}\nTone: ${articleTone}\n${extra}\n\nRespond ONLY with: {"title":"...","content":"..."}` },
  ];

  let raw = await callAI(buildMessages());
  let parsed = parseAIJson(raw);
  let wordCount = countWords(parsed.content);

  if (wordCount < lengthConfig.min || (articleLength !== "long" && wordCount > lengthConfig.max)) {
    const correction = wordCount < lengthConfig.min
      ? `IMPORTANT: Too short (${wordCount} words). Must be at least ${lengthConfig.min} words.`
      : `IMPORTANT: Too long (${wordCount} words). Must be under ${lengthConfig.max} words.`;
    raw       = await callAI(buildMessages(correction));
    parsed    = parseAIJson(raw);
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
      },
    });
    logId = log.id;
  } catch (dbErr) {
    console.error("[AI] Failed to save to AiArticleLog:", dbErr.message);
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

  const buildMessages = (extra = "") => [
    { role: "system", content: "You are an expert blog writer. Write a DIFFERENT version — new title, new angle, fresh structure. Respond with ONLY valid JSON." },
    { role: "user",   content: `Write a FRESH, DIFFERENT article:\nIdea: "${userInput}"\nSubtopics: ${subtopicsList}\nLength: ${lengthConfig.label}\nTone: ${articleTone}\n${extra}\n\nRespond ONLY with: {"title":"...","content":"..."}` },
  ];

  let raw = await callAI(buildMessages());
  let parsed = parseAIJson(raw);
  let wordCount = countWords(parsed.content);

  if (wordCount < lengthConfig.min || (articleLength !== "long" && wordCount > lengthConfig.max)) {
    const correction = wordCount < lengthConfig.min ? `Too short (${wordCount}w). Expand to ${lengthConfig.min}+.` : `Too long (${wordCount}w). Cut to under ${lengthConfig.max}.`;
    raw       = await callAI(buildMessages(correction));
    parsed    = parseAIJson(raw);
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
      },
    });
    logId = log.id;
  } catch (dbErr) {
    console.error("[AI] Failed to save regeneration to AiArticleLog:", dbErr.message);
  }

  return { title: parsed.title, content: parsed.content, wordCount, logId };
}

// ─── SAVE DRAFT ───────────────────────────────────────────────────────────────

async function saveDraft({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found. It may have expired. Please regenerate.");

  if (log.authorId && log.authorId !== authorId) {
    throw new Error("You can only save your own articles.");
  }

  if (log.savedToDraftId) {
    const existingDraft = await prisma.article.findUnique({
      where: { id: log.savedToDraftId },
      include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
    return { draft: existingDraft, alreadySaved: true };
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
    data:  { savedToDraftId: draft.id },
  });

  return { draft, alreadySaved: false };
}

// ─── LOAD TO EDITOR ────────────────────────────────────────────────────────────
// Called when user clicks "Edit" on an AI-generated article preview.
//
// Creates an Article row with status EDITING and isAiGenerated: true,
// populated from the AiArticleLog data (title + content).
// The write/create page calls GET /articles/user/editing on mount, which finds
// the most recently updated EDITING article — our new one — and loads it into
// TinyMCE. From that point the manual article workflow handles everything.
//
// If the article was already saved as a draft, we reuse that existing Article
// row and just change its status back to EDITING instead of creating a duplicate.

async function loadToEditor({ logId, authorId }) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Article log not found.");
  if (log.authorId && log.authorId !== authorId) {
    throw new Error("You can only edit your own articles.");
  }

  // If article was already saved as a draft, reuse that Article row
  if (log.savedToDraftId) {
    const article = await prisma.article.update({
      where: { id: log.savedToDraftId },
      data:  { status: "EDITING", updatedAt: new Date() },
    });
    return { articleId: article.id };
  }

  // Otherwise create a fresh Article row with EDITING status
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

  // Link the log to this article so save-draft later updates the same row
  await prisma.ai_article_logs.update({
    where: { id: logId },
    data:  { savedToDraftId: article.id },
  });

  return { articleId: article.id };
}

// ─── GET LOGS (list) ──────────────────────────────────────────────────────────

async function getArticleLogs(authorId) {
  const logs = await prisma.ai_article_logs.findMany({
    where: {
      authorId,
      savedToDraftId: null,
    },
    orderBy: { generatedAt: "desc" },
    select: {
      id:            true,
      articleTitle:  true,
      generatedAt:   true,
      wordCount:     true,
      articleLength: true,
      tone:          true,
    },
  });
  return logs;
}

// ─── GET LOG BY ID (detail) ───────────────────────────────────────────────────

async function getArticleLogById(id, authorId) {
  const log = await prisma.ai_article_logs.findUnique({ where: { id } });
  if (!log) throw new Error("Article not found.");
  if (log.authorId && log.authorId !== authorId) {
    throw new Error("You do not have permission to view this article.");
  }
  return log;
}

module.exports = {
  analyzePrompt,
  generateArticle,
  regenerateArticle,
  saveDraft,
  loadToEditor,
  getArticleLogs,
  getArticleLogById,
};

