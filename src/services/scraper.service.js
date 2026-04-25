// src/services/scraper.service.js
// Phase 1 (Init) + Phase 2 (Scraping) of the weekly content pipeline.
// Phase 1: Load sources from DB → create session → init counters.
// Phase 2: Per source — fetch homepage → collect article links → scrape each → validate → save.

const axios   = require("axios");
const cheerio = require("cheerio");
const prisma  = require("../config/prisma");

const {
  validateScrapingUrl,
  validateRedirectUrl,
  checkResponseSafety,
  sanitizeContent,
  sanitizeTitle,
  buildSecureAxiosConfig,
} = require("../utils/scraperSecurity");


// ── Constants ──────────────────────────────────────────────────────────────────

// Scraping limits
const MAX_ARTICLES_PER_SOURCE    = 7;   // max articles saved per source per session
const CANDIDATE_LINKS_PER_SOURCE = 25;  // links collected before dedup filtering
const RATE_LIMIT_MIN_MS          = 1500; // minimum polite delay between HTTP requests
const RATE_LIMIT_MAX_MS          = 2500; // maximum polite delay between HTTP requests
const HTTP_RETRY_DELAY_MS        = 3000; // wait before retrying a failed HTTP request

// DB wake-up retry delays (NeonDB free tier suspends after inactivity)
const DB_WAKEUP_DELAYS_MS = [0, 5000, 10000, 15000, 20000];

// Content validation thresholds
const DEFAULT_MIN_WORD_COUNT       = 300; // fallback if source has no minWordCount configured
const MIN_CONTENT_CHARS            = 400; // minimum characters after cleaning
const MIN_TEXT_SEGMENT_CHARS       = 30;  // minimum characters for a heading/paragraph to be kept
const MIN_TITLE_LENGTH             = 10;  // minimum characters for a valid title
const MIN_PARAGRAPH_COUNT          = 2;   // minimum paragraph breaks required

// Critical error thresholds for the session report
const CRITICAL_SUCCESS_RATE_THRESHOLD      = 50; // % — below this triggers an error alert
const CRITICAL_FAILED_CATEGORIES_THRESHOLD = 2;  // categories with zero success triggers alert

// Grace period before the process exits after a SIGTERM/SIGINT cleanup
const CLEANUP_EXIT_DELAY_MS = 2000;


// ════════════════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ════════════════════════════════════════════════════════════════════════════

// Converts the admin scrapeWindow string (e.g. "Last 7 Days") to a day count.
function parseScrapeWindowToDays(scrapeWindow) {
  if (!scrapeWindow) return null;

  const val = String(scrapeWindow).toLowerCase().trim();

  const exactMap = {
    "last 24 hours": 1,
    "last 7 days":   7,
    "last 30 days":  30,
    "3 months":      90,
    "6 months":      180,
    "1 year":        365,
  };

  if (exactMap[val] !== undefined) return exactMap[val];

  const dayMatch   = val.match(/^(?:last\s+)?(\d+)\s*days?$/);
  if (dayMatch) return parseInt(dayMatch[1]);

  const monthMatch = val.match(/^(\d+)\s*months?$/);
  if (monthMatch) return parseInt(monthMatch[1]) * 30;

  const yearMatch  = val.match(/^(\d+)\s*years?$/);
  if (yearMatch) return parseInt(yearMatch[1]) * 365;

  console.warn(`[Scraper] Unknown scrapeWindow value: "${scrapeWindow}" — no age limit applied`);
  return null;
}

// Counts words in a text string.
function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// Pauses execution for the given number of milliseconds.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pings the database to ensure it's awake before the session starts (NeonDB free tier suspends after inactivity).
async function wakeUpDatabase(maxAttempts = 5) {
  const delays = DB_WAKEUP_DELAYS_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = delays[attempt - 1] || 20000;

    if (delay > 0) {
      console.log(`[DB Wake-up] Waiting ${delay / 1000}s before retry ${attempt}/${maxAttempts}...`);
      await sleep(delay);
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(attempt > 1
        ? `[DB Wake-up] ✅ Database woke up on attempt ${attempt}`
        : "[DB Wake-up] ✅ Database connection confirmed"
      );
      return;
    } catch (err) {
      console.warn(`[DB Wake-up] ⚠️  Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }

  throw new Error(
    `Database unreachable after ${maxAttempts} attempts. ` +
    `NeonDB may be down or DATABASE_URL is incorrect. Session aborted.`
  );
}

// Strips the leading "www." from a hostname for domain comparison purposes.
function normalizeDomainForComparison(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

// Validates a redirect URL against the original hostname, allowing legitimate www↔non-www redirects.
function isRedirectAllowedDomain(redirectUrl, originalHostname) {
  const strictCheck = validateRedirectUrl(redirectUrl, originalHostname);
  if (strictCheck.safe) return { safe: true };

  if (strictCheck.reason && strictCheck.reason.startsWith("Cross-domain redirect")) {
    try {
      const redirectHostname = new URL(redirectUrl).hostname.toLowerCase();
      const normRedirect     = normalizeDomainForComparison(redirectHostname);
      const normOriginal     = normalizeDomainForComparison(originalHostname);

      const sameAfterNorm =
        normRedirect === normOriginal ||
        normRedirect.endsWith("." + normOriginal) ||
        normOriginal.endsWith("." + normRedirect);

      if (sameAfterNorm) return { safe: true };
    } catch {
      // URL parse failed — keep the original block
    }
  }

  return strictCheck;
}


// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

// Loads all active scraping sources from the database and validates each URL for security.
// Returns sources grouped by category plus a list of any blocked sources.
async function loadConfiguration() {
  console.log("[Phase 1] loadConfiguration() — fetching active sources from DB...");

  const sources = await prisma.scrapingSource.findMany({
    where: { status: "active" },
    select: {
      id:               true,
      name:             true,
      url:              true,
      category:         true,
      scrapeWindow:     true,
      minWordCount:     true,
      excludedKeywords: true,
    },
  });

  if (!sources.length) {
    console.log("[Phase 1] No active scraping sources found.");
    return { categories: [], sourcesByCategory: {}, totalSources: 0, blockedSources: [] };
  }

  // SSRF check — validates every source URL before allowing any HTTP requests
  const safeSources    = [];
  const blockedSources = [];

  for (const src of sources) {
    const check = await validateScrapingUrl(src.url);
    if (!check.safe) {
      console.warn(`[Phase 1] 🔒 BLOCKED source "${src.name}" (${src.url}): ${check.reason}`);
      blockedSources.push({ ...src, blockReason: check.reason });
    } else {
      safeSources.push(src);
    }
  }

  if (blockedSources.length > 0) {
    console.warn(`[Phase 1] 🔒 ${blockedSources.length} source(s) blocked by SSRF security checks`);
  }

  // Group safe sources by category: { "Technology": [...], "Health": [...] }
  const sourcesByCategory = {};
  for (const src of safeSources) {
    const cat = src.category || "Uncategorized";
    if (!sourcesByCategory[cat]) sourcesByCategory[cat] = [];
    sourcesByCategory[cat].push(src);
  }

  const categories = Object.keys(sourcesByCategory);
  console.log(`[Phase 1] Loaded ${safeSources.length} safe sources across ${categories.length} categories: ${categories.join(", ")}`);

  return { categories, sourcesByCategory, totalSources: safeSources.length, blockedSources };
}

// Finds the completion date of the most recent successful session.
async function getLastSuccessfulScrapeDate() {
  const last = await prisma.scrapingSession.findFirst({
    where:   { status: "completed" },
    orderBy: { completedAt: "desc" },
    select:  { completedAt: true },
  });
  const date = last?.completedAt || null;
  console.log(`[Phase 1] Last successful scrape: ${date ? date.toISOString() : "never"}`);
  return date;
}

// Creates the ScrapingSession row at the start of the job and returns its ID.
async function createScrapingSessionLog(totalSources, lastScrapeDate) {
  console.log("[Phase 1] createScrapingSessionLog()...");

  const session = await prisma.scrapingSession.create({
    data: { status: "running", lastScrapeDate, totalSources },
  });

  console.log(`[Phase 1] Session created → id: ${session.id}`);
  return session.id;
}

// Creates in-memory success/failure counters for each category.
function initializeCategoryCounters(categories) {
  console.log("[Phase 1] initializeCategoryCounters()...");
  const counters = {};
  for (const cat of categories) {
    counters[cat] = { successCount: 0, failureCount: 0, duplicateCount: 0, urlsProcessed: 0 };
  }
  return counters;
}


// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — ARTICLE SCRAPING & CONTENT VALIDATION
// ════════════════════════════════════════════════════════════════════════════

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

// Loads HTML into a Cheerio instance for DOM traversal.
function parseHTML(html) {
  return cheerio.load(html);
}

// Finds the main article content container using common CSS selectors.
function identifyArticleStructure($) {
  const selectors = [
    "article",
    '[itemprop="articleBody"]',
    ".post-content",
    ".entry-content",
    ".article-content",
    ".article-body",
    ".post-body",
    ".story-body",
    ".content-body",
    ".blog-content",
    ".blog-post-content",
    "#article-content",
    "#post-content",
    ".main-content",
    "main",
  ];

  for (const sel of selectors) {
    if ($(sel).length > 0) return $(sel).first();
  }

  return $("body");
}

// Extracts title, author, published date, and Open Graph metadata from the article page.
function extractArticleContent($, articleContainer) {
  const title =
    articleContainer.find("h1").first().text().trim() ||
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().split(/[|\-–—]/)[0].trim() ||
    "";

  const author =
    $('[rel="author"]').first().text().trim() ||
    $('[itemprop="author"]').first().text().trim() ||
    $(".author-name, .author, .byline").first().text().trim() ||
    null;

  const dateStr =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    $('[itemprop="datePublished"]').attr("content") ||
    null;

  const publishedDate = dateStr ? new Date(dateStr) : null;

  const metadata = {
    description: $('meta[name="description"]').attr("content") ||
                 $('meta[property="og:description"]').attr("content") || null,
    siteName:    $('meta[property="og:site_name"]').attr("content") || null,
    pageTitle:   $("title").text().trim() || null,
    ogImage:     $('meta[property="og:image"]').attr("content") || null,
  };

  return { title, author, publishedDate, metadata };
}

// Strips all noise from the article container (ads, nav, media, etc.) and returns
// only headings and paragraphs as clean plain text, sanitized before storage.
function cleanExtractedContent($, articleContainer) {
  $(
    "script, style, noscript, " +
    "nav, header, footer, " +
    ".nav, .navigation, .navbar, .nav-bar, .site-nav, .main-nav, " +
    ".site-header, .page-header, .site-footer, .page-footer, " +
    "aside, .sidebar, .side-bar, .widget, .widget-area, [role='complementary'], " +
    ".ad, .ads, .ad-unit, .ad-container, .ad-wrapper, .ad-banner, " +
    ".advertisement, .advertisements, .advert, .google-ad, .sponsored, " +
    '[id*="ad-"], [class*="ad-"], [id*="-ad"], [class*="-ad"], ' +
    '[id*="advert"], [class*="advert"], [id*="sponsor"], [class*="sponsor"], ' +
    ".social-share, .social-sharing, .share-buttons, .share-bar, " +
    ".social-links, .social-icons, .follow-us, .addthis, " +
    ".related-posts, .related-articles, .more-articles, .more-stories, " +
    ".recommended, .you-may-also-like, .read-next, " +
    ".newsletter, .newsletter-signup, .subscribe, .subscription-box, " +
    ".email-signup, .cta-box, " +
    ".comments, #comments, .comment-section, .disqus-container, #disqus_thread, " +
    ".popup, .modal, .overlay, .lightbox, " +
    ".cookie-banner, .cookie-notice, .gdpr-banner, .consent-banner, " +
    ".breadcrumb, .breadcrumbs, .pagination, .page-nav, .post-navigation, " +
    ".back-to-top, .scroll-to-top, " +
    "img, video, audio, picture, source, track, figure, figcaption, " +
    "iframe, embed, object, canvas, svg, " +
    ".author-bio, .author-box, .about-author, .author-profile, " +
    ".tags, .tag-list, .categories, .post-tags, .post-categories, " +
    ".entry-meta, .post-meta, " +
    '[data-print], .print-button, .toolbar, .utility-bar'
  ).remove();

  const contentParts = [];
  const seenText     = new Set();

  articleContainer.find("h1, h2, h3, h4, h5, h6, p, blockquote, li").each((_, el) => {
    const tag = $(el).prop("tagName").toLowerCase();
    let   text = $(el).text().replace(/\s+/g, " ").trim();

    if (!text || text.length < MIN_TEXT_SEGMENT_CHARS) return;
    if (seenText.has(text)) return;
    seenText.add(text);

    text = sanitizeContent(text);
    if (!text || text.length < MIN_TEXT_SEGMENT_CHARS) return;

    if      (tag === "h1")         contentParts.push(`[H1] ${text}`);
    else if (tag === "h2")         contentParts.push(`[H2] ${text}`);
    else if (tag === "h3")         contentParts.push(`[H3] ${text}`);
    else if (tag === "h4")         contentParts.push(`[H4] ${text}`);
    else if (tag === "h5")         contentParts.push(`[H5] ${text}`);
    else if (tag === "h6")         contentParts.push(`[H6] ${text}`);
    else if (tag === "blockquote") contentParts.push(`[QUOTE] ${text}`);
    else                           contentParts.push(text);
  });

  const content   = contentParts.join("\n\n");
  const wordCount = countWords(content);

  return { content, wordCount };
}

// Checks whether an article passes the age, word count, content quality, and excluded keyword rules.
function validateArticleContent(cleanedContent, title, publishedDate, source) {
  const { content, wordCount } = cleanedContent;
  const maxAgeDays   = parseScrapeWindowToDays(source.scrapeWindow);
  const minWordCount = source.minWordCount || DEFAULT_MIN_WORD_COUNT;
  const excludedKws  = source.excludedKeywords || [];

  if (publishedDate && !isNaN(publishedDate) && maxAgeDays) {
    const ageDays = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) {
      return {
        valid:  false,
        reason: `Too old: ${Math.floor(ageDays)}d (limit: ${source.scrapeWindow})`,
      };
    }
  }

  if (wordCount < minWordCount) {
    return { valid: false, reason: `Word count ${wordCount} below minimum ${minWordCount}` };
  }

  if (content.length < MIN_CONTENT_CHARS) {
    return { valid: false, reason: `Content too thin after cleaning (< ${MIN_CONTENT_CHARS} chars)` };
  }

  if (!title || title.length < MIN_TITLE_LENGTH) {
    return { valid: false, reason: "Title missing or too short" };
  }

  const paraCount = (content.match(/\n\n/g) || []).length;
  if (paraCount < MIN_PARAGRAPH_COUNT) {
    return { valid: false, reason: "No paragraph structure — likely a listing or navigation page" };
  }

  const combined = (title + " " + content).toLowerCase();
  for (const kw of excludedKws) {
    if (kw && combined.includes(kw.toLowerCase())) {
      return { valid: false, reason: `Contains excluded keyword: "${kw}"` };
    }
  }

  return { valid: true, reason: null };
}

// Checks the database for an existing article with the same URL.
async function checkDuplicateArticle(url) {
  const existing = await prisma.scrapedArticle.findUnique({
    where:  { sourceUrl: url },
    select: { id: true },
  });
  return existing !== null;
}

// Saves a cleaned article to the database (summary and keywords are null until enrichment).
async function saveScrapedArticle({
  url, title, content, author, publishedDate,
  wordCount, category, scrapingSourceId, metadata, sessionId,
}) {
  // Final sanitization before writing to the database
  const cleanTitle   = sanitizeTitle(title);
  const cleanContent = sanitizeContent(content);
  const cleanAuthor  = author ? sanitizeTitle(author) : null;

  return prisma.scrapedArticle.create({
    data: {
      sourceUrl:        url,
      title:            cleanTitle,
      content:          cleanContent,
      author:           cleanAuthor,
      publishedDate:    (publishedDate && !isNaN(publishedDate)) ? publishedDate : null,
      wordCount,
      category,
      scrapingSourceId,
      metadata:         metadata || null,
      summary:          null,
      matchedKeywords:  [],
      sessionId,
    },
  });
}

// Writes a single event (success, failure, duplicate, etc.) to the ScrapingLog table.
async function logScrapingEvent(sessionId, { logType, url, category, statusCode, reason, details }) {
  await prisma.scrapingLog.create({
    data: {
      sessionId,
      logType,
      url:        url        || "",
      category:   category   || null,
      statusCode: statusCode || null,
      reason:     reason     || null,
      details:    details    || null,
    },
  }).catch((err) => console.error(`[ScrapingLog] Write failed: ${err.message}`));
}

// Validates that a category's counters are mathematically consistent before saving to the database.
// urlsProcessed must always equal the sum of all outcomes — any mismatch is a code bug, not user error.
function validateCounters(category, c) {
  const expectedTotal = c.successCount + c.duplicateCount + c.failureCount;

  if (c.urlsProcessed !== expectedTotal) {
    console.error(
      `[Phase 2] ⚠️  Counter mismatch in "${category}": ` +
      `urlsProcessed=${c.urlsProcessed} but success(${c.successCount}) + ` +
      `dupe(${c.duplicateCount}) + fail(${c.failureCount}) = ${expectedTotal}. ` +
      `Correcting urlsProcessed to ${expectedTotal}.`
    );
    c.urlsProcessed = expectedTotal;
  }

  if (c.successCount < 0 || c.duplicateCount < 0 || c.failureCount < 0 || c.urlsProcessed < 0) {
    console.error(`[Phase 2] ⚠️  Negative counter detected in "${category}" — resetting negatives to 0.`);
    c.successCount   = Math.max(0, c.successCount);
    c.duplicateCount = Math.max(0, c.duplicateCount);
    c.failureCount   = Math.max(0, c.failureCount);
    c.urlsProcessed  = c.successCount + c.duplicateCount + c.failureCount;
  }
}

// Validates that session-level URL totals are consistent before writing the final session record.
// totalUrlsFound must equal the sum of all three outcome buckets across all categories.
function validateSessionCounters(totalUrlsFound, totalSuccess, totalDuplicate, totalFailure) {
  const expectedTotal = totalSuccess + totalDuplicate + totalFailure;

  if (totalUrlsFound !== expectedTotal) {
    console.error(
      `[Phase 2] ⚠️  Session counter mismatch: ` +
      `totalUrlsFound=${totalUrlsFound} but success(${totalSuccess}) + ` +
      `dupe(${totalDuplicate}) + fail(${totalFailure}) = ${expectedTotal}. ` +
      `Correcting totalUrlsFound to ${expectedTotal}.`
    );
    return expectedTotal;
  }

  return totalUrlsFound;
}

// Validates that enrichment counts are consistent: every scraped article must be either enriched or failed.
// successCount is the number of scraped articles — all of them should have been attempted for enrichment.
function validateEnrichmentCounters(successCount, enrichedCount, enrichmentFailed) {
  const enrichmentTotal = enrichedCount + enrichmentFailed;

  if (enrichmentTotal > successCount) {
    console.error(
      `[Phase 3] ⚠️  Enrichment counter overflow: ` +
      `enriched(${enrichedCount}) + failed(${enrichmentFailed}) = ${enrichmentTotal} ` +
      `exceeds scraped article count (${successCount}). ` +
      `Capping enrichmentFailed to ${Math.max(0, successCount - enrichedCount)}.`
    );
    return Math.max(0, successCount - enrichedCount);
  }

  return enrichmentFailed;
}

// Validates that keyword coverage counts add up to the total number of keywords in the system.
// Every keyword is either covered (has at least one article) or empty — none can be unaccounted for.
function validateKeywordCounters(keywordsCoveredCount, keywordsEmptyCount, totalKeywordsInSystem) {
  const keywordTotal = keywordsCoveredCount + keywordsEmptyCount;

  if (totalKeywordsInSystem > 0 && keywordTotal !== totalKeywordsInSystem) {
    console.error(
      `[Phase 3] ⚠️  Keyword counter mismatch: ` +
      `covered(${keywordsCoveredCount}) + empty(${keywordsEmptyCount}) = ${keywordTotal} ` +
      `but total keywords in system = ${totalKeywordsInSystem}. ` +
      `This may indicate a categoryKeywords.js change mid-session.`
    );
  }

  if (keywordsCoveredCount < 0 || keywordsEmptyCount < 0) {
    console.error(`[Phase 3] ⚠️  Negative keyword counter detected — resetting negatives to 0.`);
    return {
      keywordsCoveredCount: Math.max(0, keywordsCoveredCount),
      keywordsEmptyCount:   Math.max(0, keywordsEmptyCount),
    };
  }

  return { keywordsCoveredCount, keywordsEmptyCount };
}

// Saves the scraping result counters for one category to the CategoryScrapingStats table.
async function saveCategoryScrapingStats(sessionId, category, counters) {
  const c = counters[category];

  validateCounters(category, c);

  await prisma.categoryScrapingStats.create({
    data: {
      sessionId,
      category,
      urlsProcessed:  c.urlsProcessed,
      successCount:   c.successCount,
      duplicateCount: c.duplicateCount,
      failureCount:   c.failureCount,
    },
  });
  console.log(
    `[Phase 2] Stats saved for "${category}": ` +
    `🔗${c.urlsProcessed} processed | ✅${c.successCount} saved | ♻️${c.duplicateCount} dupes | ❌${c.failureCount} failed`
  );
}

// Orchestrates the full scrape for one source: fetches homepage, collects links, scrapes each article.
async function scrapeSource(source, sessionId, counters) {
  const { id: sourceId, url: sourceUrl, name, category } = source;

  console.log(`\n[Phase 2] ▶ "${name}" (${sourceUrl})`);

  await applyRateLimitDelay();

  // Fetch source homepage
  let homepageHtml;
  try {
    ({ htmlContent: homepageHtml } = await sendHTTPRequest(sourceUrl));
  } catch (err) {
    console.error(`[Phase 2] ❌ Homepage unreachable: ${name} — ${err.message}`);
    await logScrapingEvent(sessionId, {
      logType:    "http_error",
      url:        sourceUrl,
      category,
      statusCode: err.statusCode || 0,
      reason:     `Homepage request failed: ${err.message}`,
    });
    // The source itself counts as one URL attempted — without this,
    // failureCount increments but urlsProcessed stays 0, breaking the math.
    counters[category].urlsProcessed++;
    counters[category].failureCount++;
    return;
  }

  // Collect article links — DB error here skips the whole source gracefully
  let articleLinks;
  try {
    articleLinks = await collectArticleLinks(homepageHtml, sourceUrl);
  } catch (err) {
    console.error(`[Phase 2] ❌ Link collection failed for "${name}": ${err.message}`);
    await logScrapingEvent(sessionId, {
      logType:  "http_error",
      url:      sourceUrl,
      category,
      reason:   `Link collection failed: ${err.message}`,
    });
    // Count the source as one attempted URL so the math stays consistent.
    counters[category].urlsProcessed++;
    counters[category].failureCount++;
    return;
  }

  console.log(`[Phase 2] Found ${articleLinks.length} article links on "${name}"`);

  if (!articleLinks.length) {
    await logScrapingEvent(sessionId, {
      logType: "info",
      url:     sourceUrl,
      category,
      reason:  "No article links found on homepage",
    });
    return;
  }

  for (const articleUrl of articleLinks) {
    counters[category].urlsProcessed++;

    await applyRateLimitDelay();

    // Fetch article page
    let htmlContent;
    try {
      ({ htmlContent } = await sendHTTPRequest(articleUrl));
    } catch (err) {
      console.warn(`[Phase 2] ❌ HTTP error: ${articleUrl} — ${err.message}`);
      await logScrapingEvent(sessionId, {
        logType:    "http_error",
        url:        articleUrl,
        category,
        statusCode: err.statusCode || 0,
        reason:     err.message,
      });
      counters[category].failureCount++;
      continue;
    }

    const $                = parseHTML(htmlContent);
    const articleContainer = identifyArticleStructure($);
    const { title, author, publishedDate, metadata } = extractArticleContent($, articleContainer);
    const cleaned          = cleanExtractedContent($, articleContainer);

    console.log(`[Phase 2] Cleaned: "${title}" (${cleaned.wordCount}w)`);

    const { valid, reason } = validateArticleContent(cleaned, title, publishedDate, source);
    if (!valid) {
      console.log(`[Phase 2] ⚠️  Invalid: ${reason}`);
      await logScrapingEvent(sessionId, {
        logType:  "validation_failure",
        url:      articleUrl,
        category,
        reason,
        details:  { title, wordCount: cleaned.wordCount },
      });
      counters[category].failureCount++;
      continue;
    }

    // Check for duplicate — DB error here skips this article, not the whole session
    let isDuplicate;
    try {
      isDuplicate = await checkDuplicateArticle(articleUrl);
    } catch (err) {
      console.error(`[Phase 2] ❌ Duplicate check failed for "${articleUrl}": ${err.message}`);
      await logScrapingEvent(sessionId, {
        logType:  "http_error",
        url:      articleUrl,
        category,
        reason:   `Duplicate check DB error: ${err.message}`,
        details:  { title },
      });
      counters[category].failureCount++;
      continue;
    }

    if (isDuplicate) {
      console.log(`[Phase 2] ♻️  Duplicate: "${title}"`);
      await logScrapingEvent(sessionId, {
        logType:  "duplicate",
        url:      articleUrl,
        category,
        reason:   "URL already exists in scraped_articles",
        details:  { title },
      });
      counters[category].duplicateCount++;
      continue;
    }

    try {
      const saved = await saveScrapedArticle({
        url:              articleUrl,
        title,
        content:          cleaned.content,
        author,
        publishedDate,
        wordCount:        cleaned.wordCount,
        category,
        scrapingSourceId: sourceId,
        metadata,
        sessionId,
      });

      await logScrapingEvent(sessionId, {
        logType:  "success",
        url:      articleUrl,
        category,
        details:  { articleId: saved.id, title, wordCount: cleaned.wordCount },
      });

      counters[category].successCount++;
      console.log(`[Phase 2] ✅ Saved: "${title}" → ${saved.id}`);

    } catch (err) {
      console.error(`[Phase 2] ❌ DB save failed for "${title}": ${err.message}`);
      await logScrapingEvent(sessionId, {
        logType:  "http_error",
        url:      articleUrl,
        category,
        reason:   `DB save error: ${err.message}`,
        details:  { title },
      });
      counters[category].failureCount++;
    }
  }
}


// ════════════════════════════════════════════════════════════════════════════
// HELPERS FOR THE MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════════════

// Checks session results for critical issues (very low success rate, multiple empty categories).
function checkCriticalErrors(report, counters) {
  const issues = [];

  if (report.successRate < CRITICAL_SUCCESS_RATE_THRESHOLD && report.totalSources > 0) {
    issues.push(`Success rate critically low: ${report.successRate}% (threshold: ${CRITICAL_SUCCESS_RATE_THRESHOLD}%)`);
  }

  const totalFailedCategories = Object.entries(counters)
    .filter(([, c]) => c.successCount === 0 && c.failureCount > 0).length;
  if (totalFailedCategories >= CRITICAL_FAILED_CATEGORIES_THRESHOLD) {
    issues.push(`${totalFailedCategories} categories produced zero articles`);
  }

  return issues;
}

// Builds a partial session report from current counters for use when a session is interrupted mid-run.
function buildPartialReport(sessionId, startTime, config, counters) {
  const totalSuccess    = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
  const totalDuplicate  = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
  const totalFailure    = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
  const totalUrlsFound  = Object.values(counters).reduce((s, c) => s + c.urlsProcessed,  0);
  const durationMinutes = (Date.now() - startTime) / 60000;
  const attempted       = totalSuccess + totalFailure;

  return {
    sessionId,
    startedAt:              new Date(startTime).toISOString(),
    completedAt:            new Date().toISOString(),
    durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
    totalSources:           config?.totalSources || 0,
    totalUrlsFound,
    successCount:           totalSuccess,
    duplicateCount:         totalDuplicate,
    failureCount:           totalFailure,
    successRate:            attempted > 0 ? parseFloat(((totalSuccess / attempted) * 100).toFixed(2)) : null,
    enrichedCount:          0,
    enrichmentFailed:       0,
    keywordsWithContent:    [],
    keywordsWithoutContent: [],
    totalKeywordsCovered:   0,
    totalKeywordsEmpty:     0,
    aiTokenUsage:           { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
    criticalErrors:         true,
    isInterrupted:          true,
  };
}

// Builds a crash report when the session fails due to an unhandled error (DB down, code error, etc.).
function buildCrashReport(sessionId, startTime, config, counters, errorMessage) {
  const totalSuccess    = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
  const totalDuplicate  = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
  const totalFailure    = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
  const totalUrlsFound  = Object.values(counters).reduce((s, c) => s + c.urlsProcessed,  0);
  const durationMinutes = (Date.now() - startTime) / 60000;
  const attempted       = totalSuccess + totalFailure;

  return {
    sessionId,
    startedAt:              new Date(startTime).toISOString(),
    completedAt:            new Date().toISOString(),
    durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
    totalSources:           config?.totalSources || 0,
    totalUrlsFound,
    successCount:           totalSuccess,
    duplicateCount:         totalDuplicate,
    failureCount:           totalFailure,
    successRate:            attempted > 0 ? parseFloat(((totalSuccess / attempted) * 100).toFixed(2)) : null,
    enrichedCount:          0,
    enrichmentFailed:       0,
    keywordsWithContent:    [],
    keywordsWithoutContent: [],
    totalKeywordsCovered:   0,
    totalKeywordsEmpty:     0,
    aiTokenUsage:           { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
    criticalErrors:         true,
    isCrashed:              true,
    crashReason:            errorMessage,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — exported, called by scraper.job.js
// ════════════════════════════════════════════════════════════════════════════

// Runs the full scraping pipeline: Phase 1 (init) → Phase 2 (scrape) → Phase 3 (enrich + email).
async function runScrapingSession() {
  const { runEnrichmentStage }                         = require("./enrichment.service");
  const { sendCompletionNotification, sendErrorAlert } = require("./email.service");
  const { CATEGORY_KEYWORDS }                          = require("../config/categoryKeywords");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`[Scraper] 🚀 Session started: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}\n`);

  let sessionId  = null;
  let config     = null;
  let counters   = {};
  const startTime = Date.now();

  // Graceful shutdown — marks the session as canceled and emails a partial report if the process is killed
  let cleanupCalled = false;

  const cleanup = async (signal) => {
    if (cleanupCalled) return;
    cleanupCalled = true;

    console.warn(`\n[Scraper] ⚠️  ${signal} received — canceling session...`);

    if (!sessionId) {
      console.warn("[Scraper] Session not yet created — no DB update needed.");
      process.exit(0);
    }

    try {
      await prisma.scrapingSession.update({
        where: { id: sessionId },
        data:  { status: "canceled", completedAt: new Date(), criticalErrors: true },
      });

      const partialReport = buildPartialReport(sessionId, startTime, config, counters);

      await sendCompletionNotification(partialReport).catch((e) =>
        console.error("[Scraper] Interruption email failed:", e.message)
      );

      console.log(`[Scraper] Session ${sessionId} marked canceled. Partial report emailed.`);
    } catch (e) {
      console.error("[Scraper] Cleanup failed:", e.message);
    }

    setTimeout(() => process.exit(0), CLEANUP_EXIT_DELAY_MS);
  };

  process.once("SIGTERM", () => cleanup("SIGTERM"));
  process.once("SIGINT",  () => cleanup("SIGINT"));
  process.once("SIGHUP",  () => cleanup("SIGHUP")); // fires when terminal window is closed

  try {
    // ── Phase 1: Initialization ────────────────────────────────────────────

    await wakeUpDatabase();

    config = await loadConfiguration();
    if (!config.totalSources) {
      console.log("[Scraper] No active sources. Session skipped.");
      process.removeListener("SIGTERM", cleanup);
      process.removeListener("SIGINT",  cleanup);
      process.removeListener("SIGHUP",  cleanup);
      return;
    }

    const lastScrapeDate = await getLastSuccessfulScrapeDate();
    sessionId = await createScrapingSessionLog(config.totalSources, lastScrapeDate);
    counters  = initializeCategoryCounters(config.categories);

    await logScrapingEvent(sessionId, {
      logType: "info",
      url:     "session",
      reason:  `Initialized: ${config.categories.length} categories, ${config.totalSources} sources`,
    });

    if (config.blockedSources?.length > 0) {
      for (const blocked of config.blockedSources) {
        await logScrapingEvent(sessionId, {
          logType:  "http_error",
          url:      blocked.url,
          category: blocked.category,
          reason:   `SECURITY BLOCK: ${blocked.blockReason}`,
          details:  { sourceName: blocked.name, securityBlock: true },
        });
      }
      console.warn(`[Phase 1] 🔒 ${config.blockedSources.length} source(s) blocked — see session logs`);
    }

    // ── Phase 2: Scraping ──────────────────────────────────────────────────

    for (const category of config.categories) {
      const sources = config.sourcesByCategory[category];
      console.log(`\n[Phase 2] ══ Category: "${category}" (${sources.length} sources) ══`);

      for (const source of sources) {
        await scrapeSource(source, sessionId, counters);
      }

      await saveCategoryScrapingStats(sessionId, category, counters);
    }

    const totalSuccess   = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
    const totalDuplicate = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
    const totalFailure   = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
    const totalUrlsFound = validateSessionCounters(
      Object.values(counters).reduce((s, c) => s + c.urlsProcessed, 0),
      totalSuccess,
      totalDuplicate,
      totalFailure
    );

    console.log(`\n[Phase 2] Complete: ✅${totalSuccess} saved | ♻️${totalDuplicate} dupes | ❌${totalFailure} failed`);

    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        totalUrlsFound,
        successCount:   totalSuccess,
        duplicateCount: totalDuplicate,
        failureCount:   totalFailure,
      },
    });

    // ── Phase 3: Enrichment + Reporting ───────────────────────────────────

    let enrichmentStats = {
      keywordsWithContent:    [],
      keywordsWithoutContent: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };

    try {
      enrichmentStats = await runEnrichmentStage(sessionId);
    } catch (err) {
      console.error(`[Phase 3] Enrichment stage failed: ${err.message}`);
      await logScrapingEvent(sessionId, {
        logType: "info",
        url:     "enrichment",
        reason:  `Enrichment stage failed: ${err.message}`,
      });
    }

    const durationMinutes = (Date.now() - startTime) / 60000;
    const attempted       = totalSuccess + totalFailure;
    const successRate     = attempted > 0 ? (totalSuccess / attempted) * 100 : 0;

    const report = {
      sessionId,
      startedAt:              new Date(startTime).toISOString(),
      completedAt:            new Date().toISOString(),
      durationMinutes:        parseFloat(durationMinutes.toFixed(2)),
      totalSources:           config.totalSources,
      totalUrlsFound,
      successCount:           totalSuccess,
      duplicateCount:         totalDuplicate,
      failureCount:           totalFailure,
      successRate:            parseFloat(successRate.toFixed(2)),
      enrichedCount:          enrichmentStats.enrichedCount       || 0,
      enrichmentFailed:       enrichmentStats.enrichmentFailed    || 0,
      keywordsWithContent:    enrichmentStats.keywordsWithContent  || [],
      keywordsWithoutContent: enrichmentStats.keywordsWithoutContent || [],
      totalKeywordsCovered:   (enrichmentStats.keywordsWithContent || []).length,
      totalKeywordsEmpty:     (enrichmentStats.keywordsWithoutContent || []).length,
      aiTokenUsage:           enrichmentStats.tokenUsage,
      criticalErrors:         false,
      isInterrupted:          false,
      securityBlockedSources: (config.blockedSources || []).length,
    };

    const criticalIssues  = checkCriticalErrors(report, counters);
    report.criticalErrors = criticalIssues.length > 0;

    // Validate enrichment math: enriched + failed must not exceed total scraped articles
    report.enrichmentFailed = validateEnrichmentCounters(
      report.successCount,
      report.enrichedCount,
      report.enrichmentFailed
    );

    // Validate keyword coverage math: covered + empty must equal total keywords in system
    const totalKeywordsInSystem = Object.values(CATEGORY_KEYWORDS).reduce((s, kws) => s + kws.length, 0);
    const validatedKeywords     = validateKeywordCounters(
      report.totalKeywordsCovered,
      report.totalKeywordsEmpty,
      totalKeywordsInSystem
    );
    report.totalKeywordsCovered = validatedKeywords.keywordsCoveredCount;
    report.totalKeywordsEmpty   = validatedKeywords.keywordsEmptyCount;

    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        status:                "completed",
        completedAt:           new Date(),
        successRate:           report.successRate,
        durationMinutes:       report.durationMinutes,
        enrichedCount:         report.enrichedCount,
        enrichmentFailedCount: report.enrichmentFailed,
        keywordsCoveredCount:  report.totalKeywordsCovered,
        keywordsEmptyCount:    report.totalKeywordsEmpty,
        aiInputTokens:         report.aiTokenUsage?.inputTokens  || 0,
        aiOutputTokens:        report.aiTokenUsage?.outputTokens || 0,
        criticalErrors:        report.criticalErrors,
        reportData:            JSON.stringify(report),
      },
    });

    if (report.criticalErrors) {
      console.warn(`[Phase 3] ⚠️  Critical errors: ${criticalIssues.join(" | ")}`);
      await sendErrorAlert(report, criticalIssues).catch((e) =>
        console.error("[Phase 3] Error alert email failed:", e.message)
      );
    }

    await sendCompletionNotification(report).catch((e) =>
      console.error("[Phase 3] Completion email failed:", e.message)
    );

    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data:  { reportSentAt: new Date() },
    }).catch(() => {});

    process.removeListener("SIGTERM", cleanup);
    process.removeListener("SIGINT",  cleanup);
    process.removeListener("SIGHUP",  cleanup);

    console.log(`\n${"═".repeat(60)}`);
    console.log(`[Scraper] 🏁 Session complete. ${report.successCount} articles saved. ${report.totalKeywordsCovered} keywords covered.`);
    console.log(`${"═".repeat(60)}\n`);

    return { status: "completed", sessionId };

  } catch (err) {
    console.error(`[Scraper] ❌ Session crashed: ${err.message}`);

    process.removeListener("SIGTERM", cleanup);
    process.removeListener("SIGINT",  cleanup);
    process.removeListener("SIGHUP",  cleanup);

    if (sessionId) {
      await prisma.scrapingSession.update({
        where: { id: sessionId },
        data: {
          status:         "failed",
          completedAt:    new Date(),
          criticalErrors: true,
          reportData:     JSON.stringify({ error: err.message }),
        },
      }).catch(() => {});

      // Notify admins — a crashed session produces no normal completion email,
      // so without this admins would receive nothing and not know the session failed.
      const crashReport = buildCrashReport(sessionId, startTime, config, counters, err.message);
      await sendCompletionNotification(crashReport).catch((e) =>
        console.error("[Scraper] Crash notification email failed:", e.message)
      );
    }

    throw err;
  }
}

module.exports = { runScrapingSession };