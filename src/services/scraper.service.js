// src/services/scraper.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Content Scraping Service — Phase 1 (Initialization) + Phase 2 (Scraping)
//
// Phase 1: Load config from DB → create session log → init counters
// Phase 2: For each source URL → HTTP request → parse → clean → validate
//          → duplicate check → save raw article → log every outcome
//
// Technologies: axios (HTTP), cheerio (HTML parsing), prisma (DB)
// ─────────────────────────────────────────────────────────────────────────────

const axios   = require("axios");
const cheerio = require("cheerio");
const prisma  = require("../config/prisma");

// ── SECURITY: Import security utilities from scraperSecurity.js ──────────────
// These functions provide SSRF protection, response safety checks,
// redirect validation, and content sanitization before DB storage.
// See src/utils/scraperSecurity.js for full documentation of each function.
const {
  validateScrapingUrl,    // SSRF protection — validates source URLs before any request
  validateRedirectUrl,    // Validates redirect destinations (malicious redirect defence)
  checkResponseSafety,    // Checks Content-Type and response size
  sanitizeContent,        // Strips HTML/XSS from article body before DB save
  sanitizeTitle,          // Strips HTML/XSS from title/author before DB save
  buildSecureAxiosConfig, // Returns hardened axios config (size limits, no auto-redirect)
} = require("../utils/scraperSecurity");
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────────

// Maximum articles to collect per source URL per session.
// 7 articles × ~40 sources (20 categories × 2 URLs) = ~280 articles max per session.
const MAX_ARTICLES_PER_SOURCE = 7;

// Delay range between HTTP requests (milliseconds) — polite scraping
const RATE_LIMIT_MIN_MS = 1500;
const RATE_LIMIT_MAX_MS = 2500;


// ════════════════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ════════════════════════════════════════════════════════════════════════════

// ── parseScrapeWindowToDays ───────────────────────────────────────────────
// Converts the admin-configured scrapeWindow string to a number of days.
// Matches exactly the dropdown values in page.jsx.
// Returns null if no limit should be applied.

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

  // Flexible fallbacks for any future values the admin panel might add
  const dayMatch   = val.match(/^(?:last\s+)?(\d+)\s*days?$/);
  if (dayMatch) return parseInt(dayMatch[1]);

  const monthMatch = val.match(/^(\d+)\s*months?$/);
  if (monthMatch) return parseInt(monthMatch[1]) * 30;

  const yearMatch  = val.match(/^(\d+)\s*years?$/);
  if (yearMatch) return parseInt(yearMatch[1]) * 365;

  console.warn(`[Scraper] Unknown scrapeWindow value: "${scrapeWindow}" — no age limit applied`);
  return null;
}

// ── countWords ────────────────────────────────────────────────────────────
function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// ── sleep ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── wakeUpDatabase ────────────────────────────────────────────────────────────
// NeonDB free tier suspends the connection pool after ~5 minutes of inactivity.
// This function pings the database with a lightweight SELECT 1 query and retries
// if it fails, giving NeonDB time to wake up before the scraping session starts.
//
// Retry behaviour:
//   Attempt 1 — immediate
//   Attempt 2 — wait 5 seconds
//   Attempt 3 — wait 10 seconds
//   Attempt 4 — wait 15 seconds
//   Attempt 5 — wait 20 seconds
//   Total max wait before giving up: ~50 seconds
//
// If all 5 attempts fail, throws an error so the cron job logs the failure
// cleanly in the terminal (session never starts, next Saturday it tries again).
 
async function wakeUpDatabase(maxAttempts = 5) {
  const delays = [0, 5000, 10000, 15000, 20000]; // ms to wait before each attempt
 
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = delays[attempt - 1] || 20000;
 
    if (delay > 0) {
      console.log(`[DB Wake-up] Waiting ${delay / 1000}s before retry ${attempt}/${maxAttempts}...`);
      await sleep(delay);
    }
 
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (attempt > 1) {
        console.log(`[DB Wake-up] ✅ Database woke up on attempt ${attempt}`);
      } else {
        console.log("[DB Wake-up] ✅ Database connection confirmed");
      }
      return; // success — proceed with session
    } catch (err) {
      console.warn(`[DB Wake-up] ⚠️  Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }
 
  // All attempts exhausted
  throw new Error(
    `Database unreachable after ${maxAttempts} attempts. ` +
    `NeonDB may be down or DATABASE_URL is incorrect. ` +
    `Session aborted — will retry next Saturday.`
  );
}

// ── normalizeDomainForComparison ──────────────────────────────────────────────
// SECURITY HELPER: Strips the leading "www." from a hostname before comparison.
//
// Why needed: validateRedirectUrl() in scraperSecurity.js checks whether a
// redirect destination is on the same domain as the source. However, it uses
// a simple endsWith() check which fails when a site redirects from
// www.example.com → example.com (dropping the www prefix). This is a very
// common and harmless server-side redirect pattern. Without normalization,
// these legitimate redirects would be incorrectly blocked.
//
// Examples of what this fixes:
//   www.healthline.com → healthline.com   ✅ allowed (www dropped)
//   healthline.com → www.healthline.com   ✅ allowed (www added)
//   techcrunch.com → evil.com             ❌ still blocked (correct)
//   techcrunch.com → cdn.techcrunch.com   ✅ allowed (subdomain of same domain)

function normalizeDomainForComparison(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

// ── isRedirectAllowedDomain ───────────────────────────────────────────────────
// Wraps validateRedirectUrl() with www-normalization to prevent false blocks.
// First tries the strict check from scraperSecurity. If that blocks due to the
// www-mismatch case, applies normalized comparison as a second chance.
// All other security checks (private IP, scheme, port) are still enforced.

function isRedirectAllowedDomain(redirectUrl, originalHostname) {
  // First try the strict check from scraperSecurity.js
  const strictCheck = validateRedirectUrl(redirectUrl, originalHostname);
  if (strictCheck.safe) return { safe: true };

  // If it failed specifically due to cross-domain, check with www normalization
  if (strictCheck.reason && strictCheck.reason.startsWith("Cross-domain redirect")) {
    try {
      const redirectHostname = new URL(redirectUrl).hostname.toLowerCase();
      const normRedirect  = normalizeDomainForComparison(redirectHostname);
      const normOriginal  = normalizeDomainForComparison(originalHostname);

      // Allow if normalized domains match, or one is a subdomain of the other
      const sameAfterNorm =
        normRedirect === normOriginal ||
        normRedirect.endsWith("." + normOriginal) ||
        normOriginal.endsWith("." + normRedirect);

      if (sameAfterNorm) {
        return { safe: true }; // legitimate www↔non-www redirect
      }
    } catch {
      // If URL parsing fails, keep the original block
    }
  }

  // All other failures (private IP, bad scheme, bad port) stay blocked
  return strictCheck;
}


// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

// ── loadConfiguration ─────────────────────────────────────────────────────
// Reads all active ScrapingSource records from the database.
// Groups them by category for the scraping loop.
// Field names match admin.service.js exactly: name, url, category,
// scrapeWindow, minWordCount, excludedKeywords, status.
//
// SECURITY: After fetching, every source URL is validated with
// validateScrapingUrl() before it enters the scraping loop. Sources that
// fail the SSRF check are excluded from scraping, stored in blockedSources,
// and logged to the session log once the session is created. This prevents
// the scraper from ever making requests to internal network addresses.

async function loadConfiguration() {
  console.log("[Phase 1] loadConfiguration() — fetching active sources from DB...");

  const sources = await prisma.scrapingSource.findMany({
    where: { status: "active" },
    select: {
      id:               true,
      name:             true,
      url:              true,
      category:         true,
      scrapeWindow:     true,   // article age limit e.g. "Last 7 Days"
      minWordCount:     true,
      excludedKeywords: true,
    },
  });

  if (!sources.length) {
    console.log("[Phase 1] No active scraping sources found.");
    return { categories: [], sourcesByCategory: {}, totalSources: 0, blockedSources: [] };
  }

  // ── SECURITY: SSRF validation — check every source URL before scraping ──
  // This is done once here at session init using DNS resolution.
  // Much cheaper to do once per source than once per article link.
  // Sources that fail are excluded from this session and their admins are
  // notified via the session report email.
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
  // ─────────────────────────────────────────────────────────────────────────

  // Group by category: { Technology: [...], Health: [...], ... }
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

// ── getLastSuccessfulScrapeDate ────────────────────────────────────────────
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

// ── createScrapingSessionLog ───────────────────────────────────────────────
// Creates the ScrapingSession row at the START of the job.
// Returns sessionId — passed to all subsequent operations.

async function createScrapingSessionLog(totalSources, lastScrapeDate) {
  console.log("[Phase 1] createScrapingSessionLog()...");

  const session = await prisma.scrapingSession.create({
    data: {
      status:        "running",
      lastScrapeDate,
      totalSources,
    },
  });

  console.log(`[Phase 1] Session created → id: ${session.id}`);
  return session.id;
}

// ── initializeKeywordCounters ──────────────────────────────────────────────
// Creates in-memory counters per category.
// { Technology: { success:0, failure:0, duplicate:0, urlsProcessed:0 }, ... }

function initializeKeywordCounters(categories) {
  console.log("[Phase 1] initializeKeywordCounters()...");
  const counters = {};
  for (const cat of categories) {
    counters[cat] = { successCount: 0, failureCount: 0, duplicateCount: 0, urlsProcessed: 0 };
  }
  return counters;
}


// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — ARTICLE SCRAPING & CONTENT VALIDATION
// ════════════════════════════════════════════════════════════════════════════

// ── applyRateLimitDelay ────────────────────────────────────────────────────
// Waits 1.5–2.5 seconds between HTTP requests.

async function applyRateLimitDelay() {
  const ms = RATE_LIMIT_MIN_MS + Math.random() * (RATE_LIMIT_MAX_MS - RATE_LIMIT_MIN_MS);
  await sleep(ms);
}

// ── sendHTTPRequest ────────────────────────────────────────────────────────
// Downloads a web page using axios with hardened security settings.
// Includes one automatic retry on network errors.
// Throws on persistent failure — caller logs and continues.
//
// SECURITY ENHANCEMENTS vs original version:
//   1. Uses buildSecureAxiosConfig() instead of inline axios options.
//      This enforces: 5MB max response, 15s timeout, no auto-redirects.
//   2. Handles HTTP redirects MANUALLY (axios maxRedirects: 0).
//      Each redirect destination is validated with isRedirectAllowedDomain()
//      before being followed. This prevents redirect-based SSRF attacks
//      where a site accepts a request but redirects to an internal address.
//      The www-normalization wrapper handles legitimate www↔non-www redirects.
//   3. Checks the response Content-Type via checkResponseSafety().
//      Rejects non-HTML responses (PDFs, binaries, JSON APIs, executables).
//   4. Checks actual response size via checkResponseSafety().
//      Rejects responses over 5MB even if Content-Length was wrong/missing.
//
// NOTE on scraperSecurity.js ALLOWED_PORTS bug:
//   ALLOWED_PORTS Set contains [80, 443, 8080, 8443, ""] (mixed number/string).
//   new URL().port always returns a string, so ports 80/443 explicitly in the
//   URL would be incorrectly blocked by validateScrapingUrl. However, real
//   news sites never include explicit port numbers in their URLs, so this
//   does not affect any legitimate source in practice. Noted for future fix.

async function sendHTTPRequest(url, attempt = 1) {
  const originalHostname = new URL(url).hostname;

  try {
    // ── SECURITY: Use hardened axios config (size limits, no auto-redirects) ─
    const config   = buildSecureAxiosConfig();
    const response = await axios.get(url, config);

    // ── SECURITY: Handle redirects manually to validate each destination ─────
    // buildSecureAxiosConfig() sets maxRedirects: 0, so axios stops here
    // and gives us the redirect response. We validate before following.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const locationHeader = response.headers["location"];

      if (!locationHeader) {
        throw Object.assign(
          new Error("Redirect response missing Location header"),
          { statusCode: response.status }
        );
      }

      // Resolve relative redirects to absolute (e.g. "/new-path" → "https://site.com/new-path")
      const absoluteRedirect = locationHeader.startsWith("http")
        ? locationHeader
        : new URL(locationHeader, url).href;

      // ── Validate the redirect destination ──────────────────────────────────
      // isRedirectAllowedDomain wraps validateRedirectUrl() with www-normalization
      // to prevent false blocks on legitimate www↔non-www redirects.
      const redirectCheck = isRedirectAllowedDomain(absoluteRedirect, originalHostname);
      if (!redirectCheck.safe) {
        throw Object.assign(
          new Error(`Security: blocked redirect — ${redirectCheck.reason}`),
          { statusCode: 0, securityBlock: true }
        );
      }

      // Follow the validated redirect (one hop only — no chained redirects)
      const redirectResponse = await axios.get(absoluteRedirect, config);

      // ── Check the redirected response for safety ───────────────────────────
      const safetyCheck = checkResponseSafety(redirectResponse);
      if (!safetyCheck.safe) {
        throw Object.assign(
          new Error(`Security: ${safetyCheck.reason}`),
          { statusCode: 0, securityBlock: true }
        );
      }

      return { htmlContent: redirectResponse.data, statusCode: redirectResponse.status };
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── SECURITY: Check Content-Type and response size ────────────────────────
    // Rejects non-HTML responses (PDFs, binaries, APIs) and oversized responses.
    const safetyCheck = checkResponseSafety(response);
    if (!safetyCheck.safe) {
      throw Object.assign(
        new Error(`Security: ${safetyCheck.reason}`),
        { statusCode: 0, securityBlock: true }
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (response.status >= 400) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { statusCode: response.status });
    }

    return { htmlContent: response.data, statusCode: response.status };

  } catch (err) {
    // Security blocks are definitive — do not retry them, they will fail again
    if (err.securityBlock) throw err;

    if (attempt < 2) {
      // One retry after a short delay (same as original behaviour)
      await sleep(3000);
      return sendHTTPRequest(url, 2);
    }
    throw Object.assign(err, { statusCode: err.response?.status || 0 });
  }
}

// ── collectArticleLinks ────────────────────────────────────────────────────
// Scans the homepage HTML for links that look like individual article pages.
// Filters out navigation/category/tag/author pages.
// Returns up to MAX_ARTICLES_PER_SOURCE article URLs.
//
// SECURITY: Added port check — article links pointing to non-standard ports
// (e.g. :8000, :3000, :22) are skipped. Standard ports (80, 443, 8080, 8443)
// and no-explicit-port (default) are allowed. This prevents a malicious site
// from embedding links to internal services in its homepage HTML.

function collectArticleLinks(html, sourceUrl) {
  const $ = cheerio.load(html);
  const origin = new URL(sourceUrl).origin;
  const scored = [];

  $("a[href]").each((_, el) => {
    let href = $(el).attr("href") || "";

    // Resolve relative and protocol-relative URLs
    if (href.startsWith("//"))  href = "https:" + href;
    if (href.startsWith("/"))   href = origin + href;
    if (!href.startsWith("http")) return;

    let parsed;
    try { parsed = new URL(href); } catch { return; }

    // Must be on the same domain
    if (parsed.origin !== origin) return;

    // Strip fragment and query (we want clean article URLs)
    const cleanUrl = parsed.origin + parsed.pathname;

    // ── SECURITY: Block article links to non-standard ports ───────────────
    // A legitimate article page is always on port 80, 443, or no explicit port.
    // Links to custom ports likely point to development servers or internal services.
    const allowedArticlePorts = new Set(["", "80", "443", "8080", "8443"]);
    if (!allowedArticlePorts.has(parsed.port)) return;
    // ─────────────────────────────────────────────────────────────────────

    // Skip non-article patterns
    const skipPattern = /\/(tag|tags|category|categories|author|authors|search|page\/\d|feed|rss|wp-json|cdn-cgi|sitemap|subscribe|newsletter|login|signup|about|contact|privacy|terms|advertise|careers)\/?$/i;
    if (skipPattern.test(parsed.pathname)) return;

    // Skip root and very short paths
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 1) return;

    // Skip media files
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js)$/i.test(parsed.pathname)) return;

    // Score: more path segments + hyphens in slug = more article-like
    const lastSegment = segments[segments.length - 1] || "";
    const hyphenCount = (lastSegment.match(/-/g) || []).length;
    const score       = segments.length * 2 + hyphenCount;

    scored.push({ url: cleanUrl, score });
  });

  // Sort by score descending, deduplicate, take top N
  const seen  = new Set();
  const links = [];
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      links.push(item.url);
      if (links.length >= MAX_ARTICLES_PER_SOURCE) break;
    }
  }

  return links;
}

// ── parseHTML ─────────────────────────────────────────────────────────────
// Loads HTML into Cheerio. Returns the $ jQuery-like object.

function parseHTML(html) {
  return cheerio.load(html);
}

// ── identifyArticleStructure ──────────────────────────────────────────────
// Finds the main article container element using common CSS selectors.
// Returns the Cheerio element (articleStructure).

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

  return $("body"); // fallback
}

// ── extractArticleContent ─────────────────────────────────────────────────
// Extracts title, author, published date, and metadata from the page.
// These are pulled from semantic HTML and Open Graph meta tags.

function extractArticleContent($, articleContainer) {
  // Title: article h1 → page h1 → og:title → <title>
  const title =
    articleContainer.find("h1").first().text().trim() ||
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().split(/[|\-–—]/)[0].trim() ||
    "";

  // Author
  const author =
    $('[rel="author"]').first().text().trim() ||
    $('[itemprop="author"]').first().text().trim() ||
    $(".author-name, .author, .byline").first().text().trim() ||
    null;

  // Published date
  const dateStr =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    $('[itemprop="datePublished"]').attr("content") ||
    null;

  const publishedDate = dateStr ? new Date(dateStr) : null;

  // Metadata for storage
  const metadata = {
    description: $('meta[name="description"]').attr("content") ||
                 $('meta[property="og:description"]').attr("content") || null,
    siteName:    $('meta[property="og:site_name"]').attr("content") || null,
    pageTitle:   $("title").text().trim() || null,
    ogImage:     $('meta[property="og:image"]').attr("content") || null,
  };

  return { title, author, publishedDate, metadata };
}

// ── cleanExtractedContent ─────────────────────────────────────────────────
// Strips all noise from the article container, then extracts only
// headings and paragraphs — the meaningful content.
//
// REMOVED: scripts, styles, nav, header, footer, ads, social buttons,
//          related posts, newsletters, comments, ALL media (img/video/audio/
//          iframe/figure), popups, cookie banners, breadcrumbs, author bios,
//          tag/category links, print buttons.
//
// KEPT: h1-h6 (formatted as [H1] etc.), p, blockquote, li
//
// DEDUPLICATION: Set-based, skips any text already extracted.
//
// SECURITY: sanitizeContent() is applied to each extracted text segment
// after cheerio extraction. Even after removing noise elements, some sites
// may have malformed tags or JavaScript event attributes that survive the
// cheerio removal pass. sanitizeContent() strips any residual HTML before
// the text is assembled into the final content string for DB storage.

function cleanExtractedContent($, articleContainer) {
  // ── Remove all noise elements ────────────────────────────────────────
  $(
    "script, style, noscript, " +
    "nav, header, footer, " +
    ".nav, .navigation, .navbar, .nav-bar, .site-nav, .main-nav, " +
    ".site-header, .page-header, .site-footer, .page-footer, " +
    "aside, .sidebar, .side-bar, .widget, .widget-area, [role='complementary'], " +

    // Advertisements — many naming patterns
    ".ad, .ads, .ad-unit, .ad-container, .ad-wrapper, .ad-banner, " +
    ".advertisement, .advertisements, .advert, .google-ad, .sponsored, " +
    '[id*="ad-"], [class*="ad-"], [id*="-ad"], [class*="-ad"], ' +
    '[id*="advert"], [class*="advert"], [id*="sponsor"], [class*="sponsor"], ' +

    // Social sharing
    ".social-share, .social-sharing, .share-buttons, .share-bar, " +
    ".social-links, .social-icons, .follow-us, .addthis, " +

    // Related / recommended content
    ".related-posts, .related-articles, .more-articles, .more-stories, " +
    ".recommended, .you-may-also-like, .read-next, " +

    // Newsletter / subscribe
    ".newsletter, .newsletter-signup, .subscribe, .subscription-box, " +
    ".email-signup, .cta-box, " +

    // Comments
    ".comments, #comments, .comment-section, .disqus-container, #disqus_thread, " +

    // Popups and overlays
    ".popup, .modal, .overlay, .lightbox, " +
    ".cookie-banner, .cookie-notice, .gdpr-banner, .consent-banner, " +

    // Navigation helpers
    ".breadcrumb, .breadcrumbs, .pagination, .page-nav, .post-navigation, " +
    ".back-to-top, .scroll-to-top, " +

    // ALL media — we store text only
    "img, video, audio, picture, source, track, figure, figcaption, " +
    "iframe, embed, object, canvas, svg, " +

    // Author bio boxes
    ".author-bio, .author-box, .about-author, .author-profile, " +

    // Tags and category labels
    ".tags, .tag-list, .categories, .post-tags, .post-categories, " +
    ".entry-meta, .post-meta, " +

    // Utility elements
    '[data-print], .print-button, .toolbar, .utility-bar'
  ).remove();

  // ── Extract headings and paragraphs ──────────────────────────────────
  const contentParts = [];
  const seenText     = new Set(); // exact duplicate prevention

  articleContainer.find("h1, h2, h3, h4, h5, h6, p, blockquote, li").each((_, el) => {
    const tag = $(el).prop("tagName").toLowerCase();
    let   text = $(el).text().replace(/\s+/g, " ").trim();

    // Skip short snippets (labels, captions, button text, etc.)
    if (!text || text.length < 30) return;

    // Skip if already seen
    if (seenText.has(text)) return;
    seenText.add(text);

    // ── SECURITY: Sanitize each text segment before adding to content ────
    // cheerio .text() normally returns plain text, but on malformed pages
    // some HTML can bleed through. sanitizeContent() strips any residual
    // HTML tags and decodes HTML entities to their text equivalents.
    text = sanitizeContent(text);
    if (!text || text.length < 30) return; // re-check after sanitization
    // ─────────────────────────────────────────────────────────────────────

    // Format with structural markers for AI readability
    if      (tag === "h1")         contentParts.push(`[H1] ${text}`);
    else if (tag === "h2")         contentParts.push(`[H2] ${text}`);
    else if (tag === "h3")         contentParts.push(`[H3] ${text}`);
    else if (tag === "h4")         contentParts.push(`[H4] ${text}`);
    else if (tag === "h5")         contentParts.push(`[H5] ${text}`);
    else if (tag === "h6")         contentParts.push(`[H6] ${text}`);
    else if (tag === "blockquote") contentParts.push(`[QUOTE] ${text}`);
    else                           contentParts.push(text); // p, li
  });

  const content   = contentParts.join("\n\n");
  const wordCount = countWords(content);

  return { content, wordCount };
}

// ── validateArticleContent ────────────────────────────────────────────────
// Three validation checks from the diagram:
//   1. checkPublishDate  — article age vs admin-configured scrapeWindow
//   2. checkWordCount    — content words vs admin-configured minWordCount
//   3. checkContentQuality — structure, length, excluded keywords
//
// Returns: { valid: boolean, reason: string|null }

function validateArticleContent(cleanedContent, title, publishedDate, source) {
  const { content, wordCount } = cleanedContent;
  const maxAgeDays   = parseScrapeWindowToDays(source.scrapeWindow);
  const minWordCount = source.minWordCount || 300;
  const excludedKws  = source.excludedKeywords || [];

  // ── checkPublishDate ──────────────────────────────────────────────────
  // Only checks if:
  //   (a) the article has an extractable published date in its HTML
  //   (b) the admin set a scrapeWindow value
  if (publishedDate && !isNaN(publishedDate) && maxAgeDays) {
    const ageDays = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) {
      return {
        valid:  false,
        reason: `Too old: ${Math.floor(ageDays)}d (limit: ${source.scrapeWindow})`,
      };
    }
  }

  // ── checkWordCount ────────────────────────────────────────────────────
  if (wordCount < minWordCount) {
    return {
      valid:  false,
      reason: `Word count ${wordCount} below minimum ${minWordCount}`,
    };
  }

  // ── checkContentQuality ───────────────────────────────────────────────
  if (content.length < 400) {
    return { valid: false, reason: "Content too thin after cleaning (< 400 chars)" };
  }

  if (!title || title.length < 10) {
    return { valid: false, reason: "Title missing or too short" };
  }

  // Must have at least some paragraph structure
  const paraCount = (content.match(/\n\n/g) || []).length;
  if (paraCount < 2) {
    return { valid: false, reason: "No paragraph structure — likely a listing or navigation page" };
  }

  // Excluded keywords check (case-insensitive, checks title + content)
  const combined = (title + " " + content).toLowerCase();
  for (const kw of excludedKws) {
    if (kw && combined.includes(kw.toLowerCase())) {
      return { valid: false, reason: `Contains excluded keyword: "${kw}"` };
    }
  }

  return { valid: true, reason: null };
}

// ── checkDuplicateArticle ─────────────────────────────────────────────────
// Checks DB for existing article with same URL.
// The @unique constraint on sourceUrl is the primary guard.
// Returns true if duplicate.

async function checkDuplicateArticle(url) {
  const existing = await prisma.scrapedArticle.findUnique({
    where:  { sourceUrl: url },
    select: { id: true },
  });
  return existing !== null;
}

// ── saveScrapedArticle ────────────────────────────────────────────────────
// Saves cleaned article to scraped_articles.
// summary and matchedKeywords are null at this point — populated in Phase 3.
//
// SECURITY: sanitizeTitle() and sanitizeContent() are applied as a final
// pass immediately before writing to the database. This is the last line of
// defence against any HTML or control characters that may have survived
// cheerio extraction. Ensures only clean plain text is ever stored.

async function saveScrapedArticle({
  url, title, content, author, publishedDate,
  wordCount, category, scrapingSourceId, metadata, sessionId,
}) {
  // ── SECURITY: Final sanitization pass before DB write ────────────────
  const cleanTitle   = sanitizeTitle(title);
  const cleanContent = sanitizeContent(content);
  const cleanAuthor  = author ? sanitizeTitle(author) : null;
  // ─────────────────────────────────────────────────────────────────────

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
      summary:          null,   // populated by enrichment in Phase 3
      matchedKeywords:  [],     // populated by enrichment in Phase 3
      sessionId,
    },
  });
}

// ── logScrapingEvent ──────────────────────────────────────────────────────
// Writes one row to ScrapingLog.
// Called at every outcome point in the diagram.
// Non-blocking — failures logged to console but don't crash the scraper.

async function logScrapingEvent(sessionId, { logType, url, category, statusCode, reason, details }) {
  await prisma.scrapingLog.create({
    data: {
      sessionId,
      logType,
      url:        url     || "",
      category:   category || null,
      statusCode: statusCode || null,
      reason:     reason   || null,
      details:    details  || null,
    },
  }).catch((err) =>
    console.error(`[ScrapingLog] Write failed: ${err.message}`)
  );
}

// ── saveKeywordScrapingStats ──────────────────────────────────────────────
// Saves per-category stats to KeywordScrapingStats after all URLs
// for that category are processed.

async function saveKeywordScrapingStats(sessionId, category, counters) {
  const c = counters[category];
  await prisma.keywordScrapingStats.create({
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
    `✅${c.successCount} ♻️${c.duplicateCount} ❌${c.failureCount}`
  );
}

// ── scrapeSource ──────────────────────────────────────────────────────────
// Orchestrates scraping for ONE source URL.
// Downloads homepage → collects article links → scrapes each article.
// Updates counters and logs at every step.

async function scrapeSource(source, sessionId, counters) {
  const { id: sourceId, url: sourceUrl, name, category } = source;

  console.log(`\n[Phase 2] ▶ "${name}" (${sourceUrl})`);

  // ── Download source homepage ─────────────────────────────────────────
  await applyRateLimitDelay();

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
    counters[category].failureCount++;
    return;
  }

  // ── Collect article links from homepage ──────────────────────────────
  const articleLinks = collectArticleLinks(homepageHtml, sourceUrl);
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

  // ── Process each article link ────────────────────────────────────────
  for (const articleUrl of articleLinks) {
    counters[category].urlsProcessed++;

    await applyRateLimitDelay();

    // sendHTTPRequest
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

    // parseHTML → identifyArticleStructure → extractArticleContent
    const $                = parseHTML(htmlContent);
    const articleContainer = identifyArticleStructure($);
    const { title, author, publishedDate, metadata } = extractArticleContent($, articleContainer);

    // cleanExtractedContent
    const cleaned = cleanExtractedContent($, articleContainer);
    console.log(`[Phase 2] Cleaned: "${title}" (${cleaned.wordCount}w)`);

    // validateArticleContent
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

    // checkDuplicateArticle
    const isDuplicate = await checkDuplicateArticle(articleUrl);
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

    // saveScrapedArticle
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
// MAIN ORCHESTRATOR — exported and called by scraper.job.js
// ════════════════════════════════════════════════════════════════════════════

async function runScrapingSession() {
  const { runEnrichmentStage } = require("./enrichment.service");
  const { sendCompletionNotification, sendErrorAlert } = require("./email.service");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`[Scraper] 🚀 Session started: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}\n`);

  let sessionId  = null;
  const startTime = Date.now();
  try {
  // ── DB WAKE-UP ──────────────────────────────────────────────────────────
  await wakeUpDatabase();

  // ── PHASE 1: INITIALIZATION ─────────────────────────────────────────────
  const config = await loadConfiguration();
    if (!config.totalSources) {
      console.log("[Scraper] No active sources. Session skipped.");
      return;
    }

    const lastScrapeDate = await getLastSuccessfulScrapeDate();
    sessionId = await createScrapingSessionLog(config.totalSources, lastScrapeDate);
    const counters = initializeKeywordCounters(config.categories);

    await logScrapingEvent(sessionId, {
      logType: "info",
      url:     "session",
      reason:  `Initialized: ${config.categories.length} categories, ${config.totalSources} sources`,
    });

    // ── SECURITY: Log any sources blocked by SSRF checks in loadConfiguration ──
    // Blocked sources are logged here (after session creation) so they appear
    // in the session log and are visible in the admin session detail view.
    if (config.blockedSources && config.blockedSources.length > 0) {
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
    // ─────────────────────────────────────────────────────────────────────────

    // ── PHASE 2: SCRAPING ───────────────────────────────────────────────

    for (const category of config.categories) {
      const sources = config.sourcesByCategory[category];
      console.log(`\n[Phase 2] ══ Category: "${category}" (${sources.length} sources) ══`);

      for (const source of sources) {
        await scrapeSource(source, sessionId, counters);
      }

      // Save per-category stats after all sources in this category done
      await saveKeywordScrapingStats(sessionId, category, counters);
    }

    // Total counts
    const totalSuccess  = Object.values(counters).reduce((s, c) => s + c.successCount,   0);
    const totalDuplicate = Object.values(counters).reduce((s, c) => s + c.duplicateCount, 0);
    const totalFailure  = Object.values(counters).reduce((s, c) => s + c.failureCount,   0);
    const totalUrlsFound = Object.values(counters).reduce((s, c) => s + c.urlsProcessed, 0);

    console.log(`\n[Phase 2] Complete: ✅${totalSuccess} saved | ♻️${totalDuplicate} dupes | ❌${totalFailure} failed`);

    // Update session with Phase 2 counts
    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        totalUrlsFound,
        successCount:  totalSuccess,
        duplicateCount: totalDuplicate,
        failureCount:  totalFailure,
      },
    });

    // ── PHASE 3: ENRICHMENT + REPORTING ────────────────────────────────

    // AI enrichment — classify + summarize all newly scraped articles
    let enrichmentStats = { keywordsWithContent: [], keywordsWithoutContent: [], tokenUsage: { inputTokens: 0, outputTokens: 0 } };
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

    // Calculate final session stats
    const durationMinutes = (Date.now() - startTime) / 60000;
    const attempted       = totalSuccess + totalFailure;
    const successRate     = attempted > 0 ? (totalSuccess / attempted) * 100 : 0;

    // Build session report
    const report = {
      sessionId,
      startedAt:           new Date(startTime).toISOString(),
      completedAt:         new Date().toISOString(),
      durationMinutes:     parseFloat(durationMinutes.toFixed(2)),
      totalSources:        config.totalSources,
      totalUrlsFound,
      successCount:        totalSuccess,
      duplicateCount:      totalDuplicate,
      failureCount:        totalFailure,
      successRate:         parseFloat(successRate.toFixed(2)),
      enrichedCount:       enrichmentStats.enrichedCount       || 0,
      enrichmentFailed:    enrichmentStats.enrichmentFailed    || 0,
      keywordsWithContent: enrichmentStats.keywordsWithContent  || [],
      keywordsWithoutContent: enrichmentStats.keywordsWithoutContent || [],
      totalKeywordsCovered: (enrichmentStats.keywordsWithContent || []).length,
      totalKeywordsEmpty:   (enrichmentStats.keywordsWithoutContent || []).length,
      aiTokenUsage:        enrichmentStats.tokenUsage,
      criticalErrors:      false,
      securityBlockedSources: (config.blockedSources || []).length,
    };

    // checkCriticalErrors
    const criticalIssues = checkCriticalErrors(report, counters);
    report.criticalErrors = criticalIssues.length > 0;

    // Update session record with final data
    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data: {
        status:               "completed",
        completedAt:          new Date(),
        successRate:          report.successRate,
        durationMinutes:      report.durationMinutes,
        enrichedCount:        report.enrichedCount,
        enrichmentFailedCount: report.enrichmentFailed,
        keywordsCoveredCount: report.totalKeywordsCovered,
        keywordsEmptyCount:   report.totalKeywordsEmpty,
        aiInputTokens:        report.aiTokenUsage?.inputTokens  || 0,
        aiOutputTokens:       report.aiTokenUsage?.outputTokens || 0,
        criticalErrors:       report.criticalErrors,
        reportData:           JSON.stringify(report),
      },
    });

    // Send critical error alert FIRST if needed
    if (report.criticalErrors) {
      console.warn(`[Phase 3] ⚠️  Critical errors: ${criticalIssues.join(" | ")}`);
      await sendErrorAlert(report, criticalIssues).catch((e) =>
        console.error("[Phase 3] Error alert email failed:", e.message)
      );
    }

    // Always send completion notification
    await sendCompletionNotification(report).catch((e) =>
      console.error("[Phase 3] Completion email failed:", e.message)
    );

    await prisma.scrapingSession.update({
      where: { id: sessionId },
      data:  { reportSentAt: new Date() },
    }).catch(() => {});

    console.log(`\n${"═".repeat(60)}`);
    console.log(`[Scraper] 🏁 Session complete. ${report.successCount} articles saved. ${report.totalKeywordsCovered} keywords covered.`);
    console.log(`${"═".repeat(60)}\n`);

    return { status: "completed", sessionId };

  } catch (err) {
    console.error(`[Scraper] ❌ Session crashed: ${err.message}`);

    if (sessionId) {
      await prisma.scrapingSession.update({
        where: { id: sessionId },
        data: {
          status:      "failed",
          completedAt: new Date(),
          reportData:  JSON.stringify({ error: err.message }),
        },
      }).catch(() => {});
    }

    throw err;
  }
}

// ── checkCriticalErrors ───────────────────────────────────────────────────
// Diagram: success rate < 70%, multiple domains failing, DB issues.

function checkCriticalErrors(report, counters) {
  const issues = [];

  if (report.successRate < 70 && report.totalSources > 0) {
    issues.push(`Success rate critically low: ${report.successRate}% (threshold: 70%)`);
  }

  // Count categories where every source failed
  const totalFailedCategories = Object.entries(counters)
    .filter(([, c]) => c.successCount === 0 && c.failureCount > 0).length;
  if (totalFailedCategories >= 2) {
    issues.push(`${totalFailedCategories} categories produced zero articles`);
  }

  return issues;
}


module.exports = { runScrapingSession };
