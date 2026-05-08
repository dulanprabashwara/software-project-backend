// @ts-nocheck
// src/services/scraper/scraper.source.js
// Orchestrates the full scrape for a single source: homepage → links → articles → save.

const { applyRateLimitDelay, sendHTTPRequest, collectArticleLinks } = require("./scraper.http");
const { parseHTML, identifyArticleStructure, extractArticleContent, cleanExtractedContent, validateArticleContent } = require("./scraper.parser");
const { checkDuplicateArticle, saveScrapedArticle, logScrapingEvent } = require("./scraper.db");

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

module.exports = { scrapeSource };
