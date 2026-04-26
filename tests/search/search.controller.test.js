// tests/search/search.controller.test.js
// Unit tests for src/controllers/search.controller.js
// searchService is fully mocked so only controller logic is exercised.

jest.mock("../../src/services/search.service");

const searchService = require("../../src/services/search.service");
const {
  searchArticles,
  searchUsers,
  getSearchSuggestions,
} = require("../../src/controllers/search.controller");

// ─── Request / Response mocks ───────────────────────────────────────────────

const makeRes = () => {
  const res = {};
  res.status  = jest.fn().mockReturnValue(res);
  res.json    = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (query = {}, user = undefined) => ({
  query,
  user,
});

// sendSuccess is a thin wrapper — mock it at module level if needed,
// but the controller tests verify that service results flow through.

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
//  TC-SC-001 to TC-SC-005  searchArticles controller
// ════════════════════════════════════════════════════════════════════════════

describe("searchArticles controller", () => {

  const serviceResult = {
    articles: [{ id: "a1" }],
    total: 1, page: 1, limit: 10, totalPages: 1,
  };

  // TC-SC-001
  test("TC-SC-001: calls service with trimmed query and parsed page/limit", async () => {
    searchService.searchArticles = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "react", page: "2", limit: "5" }, { id: "user-1" });
    const res  = makeRes();
    const next = jest.fn();

    await searchArticles(req, res, next);

    expect(searchService.searchArticles).toHaveBeenCalledWith(
      expect.objectContaining({ query: "react", page: 2, limit: 5, currentUserId: "user-1" })
    );
  });

  // TC-SC-002
  test("TC-SC-002: short-circuits and returns empty payload when q is blank", async () => {
    searchService.searchArticles = jest.fn();

    const req  = makeReq({ q: "  " });
    const res  = makeRes();
    const next = jest.fn();

    await searchArticles(req, res, next);

    expect(searchService.searchArticles).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ articles: [] }) })
    );
  });

  // TC-SC-003
  test("TC-SC-003: page defaults to 1 when not supplied", async () => {
    searchService.searchArticles = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "test" });
    const res  = makeRes();
    const next = jest.fn();

    await searchArticles(req, res, next);

    expect(searchService.searchArticles).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });

  // TC-SC-004
  test("TC-SC-004: limit is capped at 50 even if a larger value is passed", async () => {
    searchService.searchArticles = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "test", limit: "200" });
    const res  = makeRes();
    const next = jest.fn();

    await searchArticles(req, res, next);

    expect(searchService.searchArticles).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
  });

  // TC-SC-005
  test("TC-SC-005: currentUserId is null when request is anonymous", async () => {
    searchService.searchArticles = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "test" }, undefined); // no user attached
    const res  = makeRes();
    const next = jest.fn();

    await searchArticles(req, res, next);

    expect(searchService.searchArticles).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserId: null })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SC-006 to TC-SC-010  searchUsers controller
// ════════════════════════════════════════════════════════════════════════════

describe("searchUsers controller", () => {

  const serviceResult = {
    users: [{ id: "u1" }],
    total: 1, page: 1, limit: 10, totalPages: 1,
  };

  // TC-SC-006
  test("TC-SC-006: calls service with correct parameters for user search", async () => {
    searchService.searchUsers = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "alice", page: "1", limit: "10" }, { id: "user-x" });
    const res  = makeRes();
    const next = jest.fn();

    await searchUsers(req, res, next);

    expect(searchService.searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ query: "alice", page: 1, limit: 10, currentUserId: "user-x" })
    );
  });

  // TC-SC-007
  test("TC-SC-007: short-circuits and returns empty payload when q is blank", async () => {
    searchService.searchUsers = jest.fn();

    const req  = makeReq({ q: "" });
    const res  = makeRes();
    const next = jest.fn();

    await searchUsers(req, res, next);

    expect(searchService.searchUsers).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ users: [] }) })
    );
  });

  // TC-SC-008
  test("TC-SC-008: page is always at least 1 (negative page input clamped)", async () => {
    searchService.searchUsers = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "bob", page: "-5" });
    const res  = makeRes();
    const next = jest.fn();

    await searchUsers(req, res, next);

    expect(searchService.searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });

  // TC-SC-009
  test("TC-SC-009: non-numeric page falls back to 1", async () => {
    searchService.searchUsers = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "bob", page: "abc" });
    const res  = makeRes();
    const next = jest.fn();

    await searchUsers(req, res, next);

    expect(searchService.searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });

  // TC-SC-010
  test("TC-SC-010: non-numeric limit falls back to 10", async () => {
    searchService.searchUsers = jest.fn().mockResolvedValue(serviceResult);

    const req  = makeReq({ q: "bob", limit: "xyz" });
    const res  = makeRes();
    const next = jest.fn();

    await searchUsers(req, res, next);

    expect(searchService.searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TC-SC-011 to TC-SC-013  getSearchSuggestions controller
// ════════════════════════════════════════════════════════════════════════════

describe("getSearchSuggestions controller", () => {

  // TC-SC-011
  test("TC-SC-011: forwards q param to service", async () => {
    searchService.getSearchSuggestions = jest.fn().mockResolvedValue({ articles: [], users: [] });

    const req  = makeReq({ q: "react" });
    const res  = makeRes();
    const next = jest.fn();

    await getSearchSuggestions(req, res, next);

    expect(searchService.getSearchSuggestions).toHaveBeenCalledWith("react");
  });

  // TC-SC-012
  test("TC-SC-012: passes empty string when q is absent", async () => {
    searchService.getSearchSuggestions = jest.fn().mockResolvedValue({ articles: [], users: [] });

    const req  = makeReq({});  // no q
    const res  = makeRes();
    const next = jest.fn();

    await getSearchSuggestions(req, res, next);

    expect(searchService.getSearchSuggestions).toHaveBeenCalledWith("");
  });

  // TC-SC-013
  test("TC-SC-013: no auth required — no user check for suggestions route", async () => {
    searchService.getSearchSuggestions = jest.fn().mockResolvedValue({ articles: [], users: [] });

    // No user on request — should succeed without throwing
    const req  = makeReq({ q: "re" }, undefined);
    const res  = makeRes();
    const next = jest.fn();

    // asyncHandler swallows the return value; just verify no synchronous throw occurs
    // and that the service was still called (confirming no auth guard is present)
    expect(() => getSearchSuggestions(req, res, next)).not.toThrow();
    // Allow the async internals to settle
    await new Promise((r) => setImmediate(r));
    expect(searchService.getSearchSuggestions).toHaveBeenCalled();
  });
});
