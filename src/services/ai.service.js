const { OpenAI }= require("openai");
const { v4: uuidv4 } = require("uuid");
const KEYWORD_LIST = require("../config/keywords");

// ── AI Client (OpenRouter, drop-in OpenAI compatible)
// 🔄 PRODUCTION: change baseURL → "https://api.openai.com/v1"
//                change apiKey  → process.env.OPENAI_API_KEY
//                change MODELS  → ["gpt-4o-mini"]
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODELS = [
  "arcee-ai/trinity-large-preview:free",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const LENGTH_CONFIG = {
  short:        { min: 300,  max: 1000, label: "300 to 1000 words"  },
  "mid-length": { min: 1000, max: 2000, label: "1000 to 2000 words" },
  long:         { min: 2000, max: 9999, label: "at least 2000 words" },
};

// In-memory session cache (stores user prompt between analyze and generate steps)
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
      console.warn(`AI model ${model} failed: ${err.message}`);
    }
  }
  throw new Error("All AI models failed.");
}

function parseAIJson(raw) {
  // Strip markdown code fences
  let cleaned = raw.replace(/```json|```/g, "").trim();
  
  // Remove bad control characters that AI models sometimes inject
  // (actual newlines/tabs inside JSON string values break JSON.parse)
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F]/g, (char) => {
    // Keep legitimate JSON escape sequences, replace everything else
    const escapes = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return escapes[char] || '';
  });
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Last resort: extract title and content with regex if JSON is still broken
    const titleMatch = raw.match(/"title"\s*:\s*"([^"]+)"/);
    const contentMatch = raw.match(/"content"\s*:\s*"([\s\S]+?)"\s*}/);
    if (titleMatch && contentMatch) {
      return {
        title: titleMatch[1],
        content: contentMatch[1].replace(/\\n/g, '\n'),
      };
    }
    throw new Error(`AI returned unparseable response: ${e.message}`);
  }
}

function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// ── ANALYZE: identify topic, match keywords, detect tone/length in prompt
async function analyzePrompt(userInput) {
  const messages = [
    { role: "system", content: "You are an assistant for a blogging platform. Respond with ONLY valid JSON. No markdown, no extra text." },
    { role: "user", content: `Analyze this blog article idea: "${userInput}"\n\nKEYWORD LIST (only select from this list exactly):\n${KEYWORD_LIST.join(", ")}\n\nTasks:\n1. Identify main topic\n2. Select 5-10 matching keywords from the list only\n3. Detect if prompt mentions article LENGTH (short/long/word count etc)\n4. Detect if prompt mentions TONE (professional/casual/humorous etc)\n\nRespond ONLY with:\n{"topic":"...","keywords":[...],"hasArticleLengthInPrompt":false,"hasToneInPrompt":false}` }
  ];

  const raw = await callAI(messages);
  const parsed = parseAIJson(raw);
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 10) : [];

  const sessionId = uuidv4();
  sessionCache.set(sessionId, { userInput, createdAt: Date.now() });

  return {
    sessionId,
    topic: parsed.topic || "",
    keywords,
    hasArticleLengthInPrompt: Boolean(parsed.hasArticleLengthInPrompt),
    hasToneInPrompt: Boolean(parsed.hasToneInPrompt),
  };
}

// ── GENERATE: write full article based on prompt + selections
async function generateArticle({ sessionId, userInput: directInput, selectedKeywords, articleLength, tone }) {
  const userInput = sessionId && sessionCache.has(sessionId) ? sessionCache.get(sessionId).userInput : directInput;
  if (!userInput?.trim()) throw new Error("No prompt available. Please start over.");

  const lengthConfig = LENGTH_CONFIG[articleLength] || LENGTH_CONFIG.short;
  const articleTone = tone || "professional";
  const subtopicsList = selectedKeywords?.length ? selectedKeywords.join(", ") : "none — generate based on user prompt alone";

  const buildMessages = (extra = "") => [
    { role: "system", content: "You are an expert blog writer. Respond with ONLY valid JSON. No markdown, no extra text." },
    { role: "user", content: `Write a blog article:\nIdea: "${userInput}"\nSubtopics: ${subtopicsList}\nLength: ${lengthConfig.label}\nTone: ${articleTone}\n${extra}\n\nRespond ONLY with: {"title":"...","content":"..."}` }
  ];

  let raw = await callAI(buildMessages());
  let parsed = parseAIJson(raw);
  let wordCount = countWords(parsed.content);

  if (wordCount < lengthConfig.min || (articleLength !== "long" && wordCount > lengthConfig.max)) {
    const correction = wordCount < lengthConfig.min
      ? `IMPORTANT: Too short (${wordCount} words). Must be at least ${lengthConfig.min} words.`
      : `IMPORTANT: Too long (${wordCount} words). Must be under ${lengthConfig.max} words.`;
    raw = await callAI(buildMessages(correction));
    parsed = parseAIJson(raw);
    wordCount = countWords(parsed.content);
  }

  return { title: parsed.title, content: parsed.content, wordCount };
}

// ── REGENERATE: fresh version with same prompt, current selections
async function regenerateArticle({ sessionId, userInput: directInput, selectedKeywords, articleLength, tone }) {
  const userInput = sessionId && sessionCache.has(sessionId) ? sessionCache.get(sessionId).userInput : directInput;
  if (!userInput?.trim()) throw new Error("No prompt available. Please start over.");

  const lengthConfig = LENGTH_CONFIG[articleLength] || LENGTH_CONFIG.short;
  const articleTone = tone || "professional";
  const subtopicsList = selectedKeywords?.length ? selectedKeywords.join(", ") : "none";

  const buildMessages = (extra = "") => [
    { role: "system", content: "You are an expert blog writer. Write a DIFFERENT version — new title, new angle, fresh structure. Respond with ONLY valid JSON." },
    { role: "user", content: `Write a FRESH, DIFFERENT article:\nIdea: "${userInput}"\nSubtopics: ${subtopicsList}\nLength: ${lengthConfig.label}\nTone: ${articleTone}\n${extra}\n\nRespond ONLY with: {"title":"...","content":"..."}` }
  ];

  let raw = await callAI(buildMessages());
  let parsed = parseAIJson(raw);
  let wordCount = countWords(parsed.content);

  if (wordCount < lengthConfig.min || (articleLength !== "long" && wordCount > lengthConfig.max)) {
    const correction = wordCount < lengthConfig.min ? `Too short (${wordCount}w). Expand to ${lengthConfig.min}+.` : `Too long (${wordCount}w). Cut to under ${lengthConfig.max}.`;
    raw = await callAI(buildMessages(correction));
    parsed = parseAIJson(raw);
    wordCount = countWords(parsed.content);
  }

  return { title: parsed.title, content: parsed.content, wordCount };
}

module.exports = { analyzePrompt, generateArticle, regenerateArticle };