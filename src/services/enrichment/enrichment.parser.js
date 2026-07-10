// @ts-nocheck
// src/services/enrichment/enrichment.parser.js
// AI response parsing and batch prompt construction.

const { MAX_CONTENT_CHARS, SUMMARY_MIN_WORDS, SUMMARY_MAX_WORDS } = require("./enrichment.constants");

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

// Builds the AI prompt asking for keyword matching and a summary for each article in the batch.
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

module.exports = { parseEnrichmentResponse, buildBatchPrompt };
