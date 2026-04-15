// tests/scraper/html-cleaning.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for the HTML parsing and content cleaning logic.
// Uses cheerio directly — no database, no HTTP calls.
//
// Run: npm test -- tests/scraper/html-cleaning.test.js
// ─────────────────────────────────────────────────────────────────────────────

const cheerio = require("cheerio");

// ── Replicate the core functions locally for isolated testing ──────────────

function identifyArticleStructure($) {
  const selectors = [
    "article", '[itemprop="articleBody"]', ".post-content",
    ".entry-content", ".article-content", ".article-body",
    ".post-body", ".story-body", ".content-body",
    "#article-content", "#post-content", ".main-content", "main",
  ];
  for (const sel of selectors) {
    if ($(sel).length > 0) return $(sel).first();
  }
  return $("body");
}

function cleanExtractedContent($, articleContainer) {
  $(
    "script, style, noscript, nav, header, footer, aside, .sidebar, .widget, " +
    ".ad, .ads, .advertisement, .advert, " +
    ".social-share, .share-buttons, .related-posts, .related-articles, " +
    ".newsletter, .subscribe, .comments, #comments, " +
    ".popup, .modal, .cookie-banner, " +
    ".breadcrumb, .pagination, " +
    "img, video, audio, picture, figure, figcaption, iframe, embed, " +
    ".author-bio, .tags, .tag-list"
  ).remove();

  const contentParts = [];
  const seenText = new Set();

  articleContainer.find("h1, h2, h3, h4, h5, h6, p, blockquote, li").each((_, el) => {
    const tag  = $(el).prop("tagName").toLowerCase();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 30) return;
    if (seenText.has(text)) return;
    seenText.add(text);

    if      (tag === "h1")         contentParts.push(`[H1] ${text}`);
    else if (tag === "h2")         contentParts.push(`[H2] ${text}`);
    else if (tag === "h3")         contentParts.push(`[H3] ${text}`);
    else if (tag === "blockquote") contentParts.push(`[QUOTE] ${text}`);
    else                           contentParts.push(text);
  });

  const content   = contentParts.join("\n\n");
  const wordCount = content.trim().split(/\s+/).filter(w => w.length > 0).length;
  return { content, wordCount };
}

// ════════════════════════════════════════════════════════════════════════════
// identifyArticleStructure
// ════════════════════════════════════════════════════════════════════════════

describe("identifyArticleStructure", () => {

  test("finds <article> element when present", () => {
    const $ = cheerio.load(`
      <html><body>
        <nav>Nav</nav>
        <article><p>Article content here</p></article>
        <footer>Footer</footer>
      </body></html>
    `);
    const result = identifyArticleStructure($);
    expect(result.prop("tagName").toLowerCase()).toBe("article");
  });

  test("finds .post-content when no article tag", () => {
    const $ = cheerio.load(`
      <html><body>
        <div class="post-content"><p>Post content</p></div>
      </body></html>
    `);
    const result = identifyArticleStructure($);
    expect(result.hasClass("post-content")).toBe(true);
  });

  test("finds .entry-content", () => {
    const $ = cheerio.load(`
      <html><body>
        <div class="entry-content"><p>Entry content</p></div>
      </body></html>
    `);
    const result = identifyArticleStructure($);
    expect(result.hasClass("entry-content")).toBe(true);
  });

  test("finds <main> as fallback", () => {
    const $ = cheerio.load(`
      <html><body><main><p>Main content</p></main></body></html>
    `);
    const result = identifyArticleStructure($);
    expect(result.prop("tagName").toLowerCase()).toBe("main");
  });

  test("falls back to <body> when no known containers found", () => {
    const $ = cheerio.load(`
      <html><body><div class="unknown"><p>Some text</p></div></body></html>
    `);
    const result = identifyArticleStructure($);
    expect(result.prop("tagName").toLowerCase()).toBe("body");
  });

  test("prioritises article over main", () => {
    const $ = cheerio.load(`
      <html><body>
        <main><p>Main content</p></main>
        <article><p>Article content</p></article>
      </body></html>
    `);
    const result = identifyArticleStructure($);
    expect(result.prop("tagName").toLowerCase()).toBe("article");
  });

});

// ════════════════════════════════════════════════════════════════════════════
// cleanExtractedContent
// ════════════════════════════════════════════════════════════════════════════

describe("cleanExtractedContent", () => {

  test("removes navigation elements", () => {
    const $ = cheerio.load(`
      <article>
        <nav>Home / Blog / Post</nav>
        <p>This is the actual article content that is meaningful and long enough to count.</p>
      </article>
    `);
    const container = $("article");
    const { content } = cleanExtractedContent($, container);
    expect(content).not.toMatch(/Home \/ Blog \/ Post/);
    expect(content).toMatch(/actual article content/);
  });

  test("removes script and style tags", () => {
    const $ = cheerio.load(`
      <article>
        <script>console.log("tracking")</script>
        <style>.ad { display: none }</style>
        <p>This is the real article content paragraph that is long enough.</p>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).not.toMatch(/console\.log/);
    expect(content).not.toMatch(/display: none/);
    expect(content).toMatch(/real article content/);
  });

  test("removes advertisement elements", () => {
    const $ = cheerio.load(`
      <article>
        <div class="ad">Buy now! Amazing offer!</div>
        <p>Here is the genuine content of this article that has enough words.</p>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).not.toMatch(/Buy now/);
    expect(content).toMatch(/genuine content/);
  });

  test("removes related posts section", () => {
    const $ = cheerio.load(`
      <article>
        <p>This is a paragraph with enough words to be meaningful and not get filtered out.</p>
        <div class="related-posts">
          <p>Read also: Another interesting article</p>
        </div>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).not.toMatch(/Read also/);
  });

  test("formats headings with structural markers", () => {
    const $ = cheerio.load(`
      <article>
        <h1>Main Title of This Very Interesting Article About Technology</h1>
        <h2>First Section Heading About Important Concepts in the Field</h2>
        <p>This is a paragraph with enough words to pass the minimum length filter for content.</p>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).toMatch(/\[H1\] Main Title/);
    expect(content).toMatch(/\[H2\] First Section/);
  });

  test("deduplicates repeated text", () => {
    const $ = cheerio.load(`
      <article>
        <p>This is a repeated paragraph that has enough characters to pass the filter.</p>
        <p>This is a repeated paragraph that has enough characters to pass the filter.</p>
        <p>This is a unique paragraph that contains different content from the others above.</p>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    const matches = content.match(/This is a repeated paragraph/g) || [];
    expect(matches).toHaveLength(1); // appears only once despite two identical tags
  });

  test("filters out text shorter than 30 characters", () => {
    const $ = cheerio.load(`
      <article>
        <p>Short.</p>
        <p>Also short text here too.</p>
        <p>This paragraph is long enough and contains meaningful content for the article body.</p>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).not.toMatch(/^Short\.$/m);
    expect(content).toMatch(/long enough/);
  });

  test("word count is calculated correctly", () => {
    const $ = cheerio.load(`
      <article>
        <p>One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.</p>
      </article>
    `);
    const { wordCount } = cleanExtractedContent($, $("article"));
    expect(wordCount).toBe(15);
  });

  test("removes images and iframes (media elements)", () => {
    const $ = cheerio.load(`
      <article>
        <img src="photo.jpg" alt="A photo"/>
        <iframe src="https://youtube.com/embed/abc"></iframe>
        <p>Article text that is substantial enough to be included in the final output.</p>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).not.toMatch(/photo\.jpg/);
    expect(content).not.toMatch(/youtube\.com/);
  });

  test("removes footer elements", () => {
    const $ = cheerio.load(`
      <article>
        <p>This is the main article content that should be preserved in the output.</p>
        <footer>Published by Easy Blogger. All rights reserved.</footer>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).not.toMatch(/All rights reserved/);
  });

  test("formats blockquotes with QUOTE marker", () => {
    const $ = cheerio.load(`
      <article>
        <p>Introductory text that provides enough context for the following quote below.</p>
        <blockquote>Innovation distinguishes between a leader and a follower said someone important.</blockquote>
      </article>
    `);
    const { content } = cleanExtractedContent($, $("article"));
    expect(content).toMatch(/\[QUOTE\]/);
  });

});
