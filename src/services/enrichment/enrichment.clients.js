// @ts-nocheck
// src/services/enrichment/enrichment.clients.js
// Builds OpenAI-compatible clients for OpenRouter, one per API key in the environment.

const { OpenAI } = require("openai");

// Free models tried in order — first available wins
const ENRICHMENT_MODELS = [
  "openai/gpt-oss-120b:free",
  "google/gemma-4-31b-it:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

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

// Module-level singleton — built once when the module loads
const CLIENTS = buildClients();

module.exports = { CLIENTS, ENRICHMENT_MODELS };
