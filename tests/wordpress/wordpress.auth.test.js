// tests/wordpress/wordpress.auth.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — WordPress OAuth & Connection Management
// Covers: initiateWordPressAuth, handleWordPressCallback,
//         getWordPressConnection, disconnectWordPress
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock.wp"));
jest.mock("axios",                   () => require("../mocks/axios.mock"));

const prisma = require("../../src/config/prisma");
const axios  = require("axios");

const {
  initiateWordPressAuth,
  handleWordPressCallback,
  getWordPressConnection,
  disconnectWordPress,
} = require("../../src/services/wordpress.service");

const {
  MOCK_USER,
  MOCK_WP_CONNECTION,
  MOCK_WP_CONNECTION_PUBLIC,
  MOCK_WP_TOKEN_RESPONSE,
  MOCK_WP_ME_RESPONSE,
  VALID_OAUTH_STATE,
  INVALID_OAUTH_STATE,
} = require("./fixtures");

// ─── Reset mocks before each test ────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  // Default env configuration — individual tests override when needed
  process.env.WORDPRESS_CLIENT_ID     = "test_client_id_12345";
  process.env.WORDPRESS_CLIENT_SECRET = "test_client_secret_abc";
  process.env.WORDPRESS_REDIRECT_URI  = "https://test.ngrok.app/api/wordpress/callback";
  process.env.CLIENT_URL              = "http://localhost:3000";
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 1: initiateWordPressAuth
// ═════════════════════════════════════════════════════════════════════════════

describe("initiateWordPressAuth", () => {

  // TC-AUTH-001
  test("TC-AUTH-001 | returns a valid WordPress.com OAuth2 URL", () => {
    const url = initiateWordPressAuth(MOCK_USER.id);
    expect(url).toMatch(/^https:\/\/public-api\.wordpress\.com\/oauth2\/authorize/);
  });

  // TC-AUTH-002
  test("TC-AUTH-002 | URL contains correct client_id", () => {
    const url = initiateWordPressAuth(MOCK_USER.id);
    expect(url).toContain("client_id=test_client_id_12345");
  });

  // TC-AUTH-003
  test("TC-AUTH-003 | URL contains correct redirect_uri", () => {
    const url = initiateWordPressAuth(MOCK_USER.id);
    expect(url).toContain(encodeURIComponent("https://test.ngrok.app/api/wordpress/callback"));
  });

  // TC-AUTH-004
  test("TC-AUTH-004 | URL contains response_type=code", () => {
    const url = initiateWordPressAuth(MOCK_USER.id);
    expect(url).toContain("response_type=code");
  });

  // TC-AUTH-005
  test("TC-AUTH-005 | URL contains scope=posts auth", () => {
    const url = initiateWordPressAuth(MOCK_USER.id);
    expect(url).toContain("scope=posts+auth");
  });

  // TC-AUTH-006
  test("TC-AUTH-006 | state param encodes the userId in base64url", () => {
    const url      = initiateWordPressAuth(MOCK_USER.id);
    const parsed   = new URL(url);
    const state    = parsed.searchParams.get("state");
    const decoded  = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    expect(decoded.userId).toBe(MOCK_USER.id);
  });

  // TC-AUTH-007
  test("TC-AUTH-007 | different userIds produce different state values", () => {
    const url1 = initiateWordPressAuth("user_aaa");
    const url2 = initiateWordPressAuth("user_bbb");
    const state1 = new URL(url1).searchParams.get("state");
    const state2 = new URL(url2).searchParams.get("state");
    expect(state1).not.toBe(state2);
  });

  // TC-AUTH-008
  test("TC-AUTH-008 | throws ApiError.internal when WORDPRESS_CLIENT_ID is missing", () => {
    delete process.env.WORDPRESS_CLIENT_ID;
    expect(() => initiateWordPressAuth(MOCK_USER.id)).toThrow();
  });

  // TC-AUTH-009
  test("TC-AUTH-009 | throws ApiError.internal when WORDPRESS_REDIRECT_URI is missing", () => {
    delete process.env.WORDPRESS_REDIRECT_URI;
    expect(() => initiateWordPressAuth(MOCK_USER.id)).toThrow();
  });

  // TC-AUTH-010
  test("TC-AUTH-010 | error message mentions configuration when env vars missing", () => {
    delete process.env.WORDPRESS_CLIENT_ID;
    expect(() => initiateWordPressAuth(MOCK_USER.id)).toThrow(/configured/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 2: handleWordPressCallback
// ═════════════════════════════════════════════════════════════════════════════

describe("handleWordPressCallback", () => {

  // TC-CB-001
  test("TC-CB-001 | successfully exchanges code and saves connection", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE });
    axios.get.mockResolvedValue({ data: MOCK_WP_ME_RESPONSE });
    prisma.wordPressConnection.upsert.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    const result = await handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE);

    expect(result).toMatchObject({
      userId:     MOCK_USER.id,
      siteUrl:    MOCK_WP_TOKEN_RESPONSE.blog_url,
      siteId:     String(MOCK_WP_TOKEN_RESPONSE.blog_id),
      wpUsername: MOCK_WP_ME_RESPONSE.display_name,
    });
  });

  // TC-CB-002
  test("TC-CB-002 | calls axios.post to token endpoint with correct grant_type", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE });
    axios.get.mockResolvedValue({ data: MOCK_WP_ME_RESPONSE });
    prisma.wordPressConnection.upsert.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE);

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain("oauth2/token");
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=auth_code_abc");
  });

  // TC-CB-003
  test("TC-CB-003 | calls WordPress /me endpoint to fetch user profile", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE });
    axios.get.mockResolvedValue({ data: MOCK_WP_ME_RESPONSE });
    prisma.wordPressConnection.upsert.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE);

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/me"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("Bearer") }),
      })
    );
  });

  // TC-CB-004
  test("TC-CB-004 | upserts WordPressConnection record in database", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE });
    axios.get.mockResolvedValue({ data: MOCK_WP_ME_RESPONSE });
    prisma.wordPressConnection.upsert.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE);

    expect(prisma.wordPressConnection.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.wordPressConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { userId: MOCK_USER.id },
        create: expect.objectContaining({ userId: MOCK_USER.id }),
        update: expect.objectContaining({ accessToken: MOCK_WP_TOKEN_RESPONSE.access_token }),
      })
    );
  });

  // TC-CB-005
  test("TC-CB-005 | mirrors siteId onto User.wordpressAccountId", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE });
    axios.get.mockResolvedValue({ data: MOCK_WP_ME_RESPONSE });
    prisma.wordPressConnection.upsert.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: MOCK_USER.id },
      data:  { wordpressAccountId: String(MOCK_WP_TOKEN_RESPONSE.blog_id) },
    });
  });

  // TC-CB-006
  test("TC-CB-006 | throws badRequest on invalid (non-base64) state param", async () => {
    await expect(
      handleWordPressCallback("auth_code_abc", INVALID_OAUTH_STATE)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  // TC-CB-007
  test("TC-CB-007 | throws badRequest when state decodes but has no userId", async () => {
    const stateNoUser = Buffer.from(JSON.stringify({ other: "data" })).toString("base64url");
    await expect(
      handleWordPressCallback("auth_code_abc", stateNoUser)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  // TC-CB-008
  test("TC-CB-008 | throws badRequest when token exchange fails with WordPress error", async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: "invalid_code", error_description: "The code is expired." } },
    });

    await expect(
      handleWordPressCallback("bad_code", VALID_OAUTH_STATE)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  // TC-CB-009
  test("TC-CB-009 | error message from WordPress is propagated on token failure", async () => {
    axios.post.mockRejectedValue({
      response: { data: { error_description: "The code is expired." } },
    });

    await expect(
      handleWordPressCallback("bad_code", VALID_OAUTH_STATE)
    ).rejects.toMatchObject({ message: expect.stringContaining("expired") });
  });

  // TC-CB-010
  test("TC-CB-010 | throws internal when /me profile fetch fails", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE });
    axios.get.mockRejectedValue(new Error("Network error"));

    await expect(
      handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE)
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  // TC-CB-011
  test("TC-CB-011 | stores blog_id as a string (Prisma expects String, WP returns Number)", async () => {
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE }); // blog_id is Number
    axios.get.mockResolvedValue({ data: MOCK_WP_ME_RESPONSE });
    prisma.wordPressConnection.upsert.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE);

    const upsertCall = prisma.wordPressConnection.upsert.mock.calls[0][0];
    expect(typeof upsertCall.create.siteId).toBe("string");
  });

  // TC-CB-012
  test("TC-CB-012 | handles WP user with no display_name by falling back to username", async () => {
    const meWithoutDisplayName = { ...MOCK_WP_ME_RESPONSE, display_name: "", username: "emma_wp" };
    axios.post.mockResolvedValue({ data: MOCK_WP_TOKEN_RESPONSE });
    axios.get.mockResolvedValue({ data: meWithoutDisplayName });
    prisma.wordPressConnection.upsert.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await handleWordPressCallback("auth_code_abc", VALID_OAUTH_STATE);

    const upsertCall = prisma.wordPressConnection.upsert.mock.calls[0][0];
    expect(upsertCall.create.wpUsername).toBe("emma_wp");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 3: getWordPressConnection
// ═════════════════════════════════════════════════════════════════════════════

describe("getWordPressConnection", () => {

  // TC-STATUS-001
  test("TC-STATUS-001 | returns connection data when user is connected", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION_PUBLIC);

    const result = await getWordPressConnection(MOCK_USER.id);

    expect(result).toMatchObject({
      siteUrl:    MOCK_WP_CONNECTION.siteUrl,
      wpUsername: MOCK_WP_CONNECTION.wpUsername,
    });
  });

  // TC-STATUS-002
  test("TC-STATUS-002 | returns null when user has no connection", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(null);

    const result = await getWordPressConnection(MOCK_USER.id);

    expect(result).toBeNull();
  });

  // TC-STATUS-003
  test("TC-STATUS-003 | queries by userId", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(null);

    await getWordPressConnection(MOCK_USER.id);

    expect(prisma.wordPressConnection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MOCK_USER.id } })
    );
  });

  // TC-STATUS-004
  test("TC-STATUS-004 | does not return accessToken in the result (security check)", async () => {
    // The service uses `select` to explicitly exclude accessToken.
    // We verify the select object does NOT include accessToken.
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION_PUBLIC);

    await getWordPressConnection(MOCK_USER.id);

    const callArg = prisma.wordPressConnection.findUnique.mock.calls[0][0];
    expect(callArg.select).toBeDefined();
    expect(callArg.select.accessToken).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP 4: disconnectWordPress
// ═════════════════════════════════════════════════════════════════════════════

describe("disconnectWordPress", () => {

  // TC-DISC-001
  test("TC-DISC-001 | successfully disconnects when connection exists", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.wordPressConnection.delete.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    const result = await disconnectWordPress(MOCK_USER.id);

    expect(result).toEqual({ disconnected: true });
  });

  // TC-DISC-002
  test("TC-DISC-002 | deletes the WordPressConnection row", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.wordPressConnection.delete.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await disconnectWordPress(MOCK_USER.id);

    expect(prisma.wordPressConnection.delete).toHaveBeenCalledWith({
      where: { userId: MOCK_USER.id },
    });
  });

  // TC-DISC-003
  test("TC-DISC-003 | clears User.wordpressAccountId after disconnect", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.wordPressConnection.delete.mockResolvedValue(MOCK_WP_CONNECTION);
    prisma.user.update.mockResolvedValue(MOCK_USER);

    await disconnectWordPress(MOCK_USER.id);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: MOCK_USER.id },
      data:  { wordpressAccountId: null },
    });
  });

  // TC-DISC-004
  test("TC-DISC-004 | throws 404 when no connection exists", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(null);

    await expect(disconnectWordPress(MOCK_USER.id))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  // TC-DISC-005
  test("TC-DISC-005 | does not call delete when connection is not found", async () => {
    prisma.wordPressConnection.findUnique.mockResolvedValue(null);

    await expect(disconnectWordPress(MOCK_USER.id)).rejects.toThrow();
    expect(prisma.wordPressConnection.delete).not.toHaveBeenCalled();
  });
});
