// @ts-nocheck
// src/services/scraper/scraper.http.js
// HTTP request handling and article link collection for the scraping pipeline.

const axios   = require("axios");
const cheerio = require("cheerio");
const prisma  = require("../../config/prisma");

const {
  checkResponseSafety,
  buildSecureAxiosConfig,
} = require("../../utils/scraperSecurity");

const {
  MAX_ARTICLES_PER_SOURCE,
  CANDIDATE_LINKS_PER_SOURCE,
  RATE_LIMIT_MIN_MS,
  RATE_LIMIT_MAX_MS,
  HTTP_RETRY_DELAY_MS,
} = require("./scraper.constants");

const { sleep, isRedirectAllowedDomain } = require("./scraper.utils");


// PHASE 2 — ARTICLE SCRAPING & CONTENT VALIDATION


// Waits a random 1.5–2.5 second delay to avoid overwhelming target servers.
async function applyRateLimitDelay() {
  const ms = RATE_LIMIT_MIN_MS + Math.random() * (RATE_LIMIT_MAX_MS - RATE_LIMIT_MIN_MS);
  await sleep(ms);
}

// Downloads a web page using hardened axios settings (size limits, manual redirect validation, one retry).
async function sendHTTPRequest(url, attempt = 1) {
  const originalHostname = new URL(url).hostname;

  try {
    const config   = buildSecureAxiosConfig();
    const response = await axios.get(url, config);

    // Manual redirect handling — each redirect destination is validated before following
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const locationHeader = response.headers["location"];

      if (!locationHeader) {
        throw Object.assign(
          new Error("Redirect response missing Location header"),
          { statusCode: response.status }
        );
      }

      const absoluteRedirect = locationHeader.startsWith("http")
        ? locationHeader
        : new URL(locationHeader, url).href;

      const redirectCheck = isRedirectAllowedDomain(absoluteRedirect, originalHostname);
      if (!redirectCheck.safe) {
        throw Object.assign(
          new Error(`Security: blocked redirect — ${redirectCheck.reason}`),
          { statusCode: 0, securityBlock: true }
        );
      }

      const redirectResponse = await axios.get(absoluteRedirect, config);

      const safetyCheck = checkResponseSafety(redirectResponse);
      if (!safetyCheck.safe) {
        throw Object.assign(
          new Error(`Security: ${safetyCheck.reason}`),
          { statusCode: 0, securityBlock: true }
        );
      }

      return { htmlContent: redirectResponse.data, statusCode: redirectResponse.status };
    }

    // Check Content-Type and size — rejects non-HTML and oversized responses
    const safetyCheck = checkResponseSafety(response);
    if (!safetyCheck.safe) {
      throw Object.assign(
        new Error(`Security: ${safetyCheck.reason}`),
        { statusCode: 0, securityBlock: true }
      );
    }

    if (response.status >= 400) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { statusCode: response.status });
    }

    return { htmlContent: response.data, statusCode: response.status };

  } catch (err) {
    if (err.securityBlock) throw err; // security blocks are definitive — no retry

    if (attempt < 2) {
      await sleep(HTTP_RETRY_DELAY_MS);
      return sendHTTPRequest(url, 2);
    }
    throw Object.assign(err, { statusCode: err.response?.status || 0 });
  }
}

// Scans the homepage HTML for article links, deduplicates against the database,
// and returns up to MAX_ARTICLES_PER_SOURCE URLs — fresh articles first.
async function collectArticleLinks(html, sourceUrl) {
  const $ = cheerio.load(html);
  const origin = new URL(sourceUrl).origin;
  const scored = [];

  $("a[href]").each((_, el) => {
    let href = $(el).attr("href") || "";

    if (href.startsWith("//"))  href = "https:" + href;
    if (href.startsWith("/"))   href = origin + href;
    if (!href.startsWith("http")) return;

    let parsed;
    try { parsed = new URL(href); } catch { return; }

    if (parsed.origin !== origin) return;

    const cleanUrl = parsed.origin + parsed.pathname;

    // Block article links to non-standard ports
    const allowedArticlePorts = new Set(["", "80", "443", "8080", "8443"]);
    if (!allowedArticlePorts.has(parsed.port)) return;

    const skipPattern = /\/(tag|tags|category|categories|author|authors|search|page\/\d|feed|rss|wp-json|cdn-cgi|sitemap|subscribe|newsletter|login|signup|about|contact|privacy|terms|advertise|careers)\/?$/i;
    if (skipPattern.test(parsed.pathname)) return;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 1) return;

    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js)$/i.test(parsed.pathname)) return;

    const lastSegment = segments[segments.length - 1] || "";
    const hyphenCount = (lastSegment.match(/-/g) || []).length;
    const score       = segments.length * 2 + hyphenCount;

    scored.push({ url: cleanUrl, score });
  });

  // Deduplicate within the page and take top candidates
  const seen       = new Set();
  const candidates = [];
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      candidates.push(item.url);
      if (candidates.length >= CANDIDATE_LINKS_PER_SOURCE) break;
    }
  }

  if (!candidates.length) return [];

  // Bulk-check which candidates already exist in the database
  const existingRecords = await prisma.scrapedArticle.findMany({
    where:  { sourceUrl: { in: candidates } },
    select: { sourceUrl: true },
  });
  const alreadyScraped = new Set(existingRecords.map((r) => r.sourceUrl));

  const fresh = candidates.filter((url) => !alreadyScraped.has(url));
  const known = candidates.filter((url) =>  alreadyScraped.has(url));

  // Fresh articles fill the quota first; fall back to known ones only if needed
  const selected = [
    ...fresh.slice(0, MAX_ARTICLES_PER_SOURCE),
    ...known.slice(0, Math.max(0, MAX_ARTICLES_PER_SOURCE - fresh.length)),
  ].slice(0, MAX_ARTICLES_PER_SOURCE);

  console.log(
    `[Phase 2] Link selection: ${fresh.length} fresh + ${known.length} known → ` +
    `returning ${selected.length} (${Math.min(fresh.length, MAX_ARTICLES_PER_SOURCE)} fresh)`
  );

  return selected;
}

module.exports = {
  applyRateLimitDelay,
  sendHTTPRequest,
  collectArticleLinks,
};
