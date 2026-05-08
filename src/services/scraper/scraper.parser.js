// @ts-nocheck
// src/services/scraper/scraper.parser.js
// HTML parsing, content extraction, and article validation for the scraping pipeline.

const cheerio = require("cheerio");

const {
  sanitizeContent,
  sanitizeTitle,
} = require("../../utils/scraperSecurity");

const {
  DEFAULT_MIN_WORD_COUNT,
  MIN_CONTENT_CHARS,
  MIN_TEXT_SEGMENT_CHARS,
  MIN_TITLE_LENGTH,
  MIN_PARAGRAPH_COUNT,
} = require("./scraper.constants");

const { parseScrapeWindowToDays, countWords } = require("./scraper.utils");

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

module.exports = {
  parseHTML,
  identifyArticleStructure,
  extractArticleContent,
  cleanExtractedContent,
  validateArticleContent,
};
