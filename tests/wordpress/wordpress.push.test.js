// tests/wordpress/wordpress.push.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — pushArticleToWordPress (core HTTP publish function)
// This function is the direct WordPress REST API call layer.
// It is tested in isolation from the scheduling/job logic.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock.wp"));
jest.mock("axios",                   () => require("../mocks/axios.mock"));

const axios = require("axios");

const { pushArticleToWordPress } = require("../../src/services/wordpress.service");

const {
  MOCK_ARTICLE,
  MOCK_ARTICLE_NO_EXTRAS,
  MOCK_WP_CONNECTION,
  MOCK_WP_POST_RESPONSE,
} = require("./fixtures");

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLIENT_URL = "http://localhost:3000";
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 5: pushArticleToWordPress
// ═════════════════════════════════════════════════════════════════════════════

describe("pushArticleToWordPress", () => {

  // TC-PUSH-001
  test("TC-PUSH-001 | returns wpPostId and wpPostUrl on success", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    const result = await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    expect(result).toEqual({
      wpPostId:  String(MOCK_WP_POST_RESPONSE.ID),
      wpPostUrl: MOCK_WP_POST_RESPONSE.URL,
    });
  });

  // TC-PUSH-002
  test("TC-PUSH-002 | wpPostId is always returned as a string", async () => {
    axios.post.mockResolvedValue({ data: { ...MOCK_WP_POST_RESPONSE, ID: 555000 } });

    const result = await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    expect(typeof result.wpPostId).toBe("string");
  });

  // TC-PUSH-003
  test("TC-PUSH-003 | calls correct WordPress REST API endpoint", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [url] = axios.post.mock.calls[0];
    expect(url).toContain(`/sites/${MOCK_WP_CONNECTION.siteId}/posts/new`);
  });

  // TC-PUSH-004
  test("TC-PUSH-004 | sends Authorization header with Bearer token", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers.Authorization).toBe(`Bearer ${MOCK_WP_CONNECTION.accessToken}`);
  });

  // TC-PUSH-005
  test("TC-PUSH-005 | sends article title in post body", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.title).toBe(MOCK_ARTICLE.title);
  });

  // TC-PUSH-006
  test("TC-PUSH-006 | article content is included in post body", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.content).toContain(MOCK_ARTICLE.content);
  });

  // TC-PUSH-007
  test("TC-PUSH-007 | canonical URL snippet is prepended to content", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.content).toContain("canonical");
    expect(body.content).toContain(MOCK_ARTICLE.slug);
  });

  // TC-PUSH-008
  test("TC-PUSH-008 | canonical URL contains the CLIENT_URL domain", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.content).toContain("http://localhost:3000");
  });

  // TC-PUSH-009
  test("TC-PUSH-009 | canonical snippet is omitted when CLIENT_URL env var is not set", async () => {
    delete process.env.CLIENT_URL;
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    // Content should just be the article content with no canonical prefix
    expect(body.content).not.toContain("<link rel=\"canonical\"");
  });

  // TC-PUSH-010
  test("TC-PUSH-010 | status is set to publish", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.status).toBe("publish");
  });

  // TC-PUSH-011
  test("TC-PUSH-011 | tags are sent as a comma-separated string", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.tags).toBe("TypeScript,JavaScript,Web Development");
  });

  // TC-PUSH-012
  test("TC-PUSH-012 | coverImage is sent as featured_image", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.featured_image).toBe(MOCK_ARTICLE.coverImage);
  });

  // TC-PUSH-013
  test("TC-PUSH-013 | tags field is omitted when article has no tags", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE_NO_EXTRAS, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.tags).toBeUndefined();
  });

  // TC-PUSH-014
  test("TC-PUSH-014 | featured_image is omitted when article has no coverImage", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE_NO_EXTRAS, MOCK_WP_CONNECTION);

    const [, body] = axios.post.mock.calls[0];
    expect(body.featured_image).toBeUndefined();
  });

  // TC-PUSH-015
  test("TC-PUSH-015 | throws Error when WordPress API returns a 403", async () => {
    axios.post.mockRejectedValue({
      response: { data: { message: "Forbidden: insufficient permissions." } },
    });

    await expect(pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION))
      .rejects.toThrow("Forbidden: insufficient permissions.");
  });

  // TC-PUSH-016
  test("TC-PUSH-016 | throws Error when WordPress API returns a 401 (token expired)", async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: "unauthorized", message: "Token has expired." } },
    });

    await expect(pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION))
      .rejects.toThrow("Token has expired.");
  });

  // TC-PUSH-017
  test("TC-PUSH-017 | throws Error with network error message when axios throws without response", async () => {
    axios.post.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION))
      .rejects.toThrow("connect ECONNREFUSED");
  });

  // TC-PUSH-018
  test("TC-PUSH-018 | throws a plain Error (not ApiError) so the caller can handle gracefully", async () => {
    axios.post.mockRejectedValue(new Error("timeout"));

    const error = await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION)
      .catch(e => e);

    // Should be a plain Error, not an ApiError with statusCode
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBeUndefined();
  });

  // TC-PUSH-019
  test("TC-PUSH-019 | uses a 15 second timeout on the axios call", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_POST_RESPONSE });

    await pushArticleToWordPress(MOCK_ARTICLE, MOCK_WP_CONNECTION);

    const [, , config] = axios.post.mock.calls[0];
    expect(config.timeout).toBe(15000);
  });
});
