// tests/auth/auth.middleware.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the four Express middleware functions in src/middlewares/auth.js:
//   • authenticate    – verifies Firebase token → attaches req.user
//   • authorize       – checks req.user.role is in the allowed list
//   • requirePremium  – checks req.user.isPremium (admins bypass)
//   • optionalAuth    – silently attaches req.user when token exists
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Swap real Firebase Admin and Prisma with fakes ────────────────────────
jest.mock("../../src/config/firebase", () => require("../mocks/firebase.mock"));
jest.mock("../../src/config/prisma",   () => require("../mocks/prisma.mock.auth"));

const admin  = require("../../src/config/firebase");
const prisma = require("../../src/config/prisma");
const { authenticate, authorize, requirePremium, optionalAuth } = require("../../src/middlewares/auth");

// ── 2. Helper: build a minimal Express-style mock req / res / next ────────────
function makeReqResNext(headers = {}, user = undefined) {
  const req = { headers, user };
  const res = {
    status: jest.fn().mockReturnThis(), // supports res.status(401).json(...)
    json:   jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

// A realistic fake user row as Prisma would return it
const MOCK_DB_USER = {
  id:          "db-user-id-001",
  firebaseUid: "firebase-uid-abc",
  email:       "test@example.com",
  username:    "testuser",
  role:        "USER",
  isPremium:   false,
  bannedRecord: null,      // not banned
};

const MOCK_ADMIN_USER = { ...MOCK_DB_USER, id: "db-admin-id-002", role: "ADMIN" };
const MOCK_PREMIUM_USER = { ...MOCK_DB_USER, id: "db-premium-id-003", isPremium: true };

// ── 3. Reset all mock call counts before every test ──────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
});


// ════════════════════════════════════════════════════════════════════════════
//  authenticate middleware
// ════════════════════════════════════════════════════════════════════════════
describe("authenticate middleware", () => {

  test("returns 401 when Authorization header is missing", async () => {
    const { req, res, next } = makeReqResNext({});  // no authorization header

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: "Access denied. No token provided.",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when Authorization header does not start with 'Bearer '", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Basic abc123" });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when Firebase rejects the token (auth/invalid-id-token)", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer bad-token" });

    // Make Firebase throw an auth error
    admin.auth().verifyIdToken.mockRejectedValue({ code: "auth/invalid-id-token" });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: "Invalid or expired token.",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 specifically when token is expired (auth/id-token-expired)", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer expired-token" });

    admin.auth().verifyIdToken.mockRejectedValue({ code: "auth/id-token-expired" });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "Token expired. Please log in again.",
    }));
  });

  test("returns 401 when Firebase UID has no matching Postgres user", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "uid-no-postgres-user" });
    prisma.user.findUnique.mockResolvedValue(null);  // user not found in DB

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "User not found. Please register first.",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when the user has an active permanent ban", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-abc" });
    prisma.user.findUnique.mockResolvedValue({
      ...MOCK_DB_USER,
      bannedRecord: {
        reason:      "Violated community guidelines",
        bannedUntil: null,   // null = permanent ban
      },
    });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "Your account has been suspended.",
      reason:  "Violated community guidelines",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when the user has a temporary ban that has NOT expired yet", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days from now

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-abc" });
    prisma.user.findUnique.mockResolvedValue({
      ...MOCK_DB_USER,
      bannedRecord: {
        reason:      "Spam",
        bannedUntil: futureDate,
      },
    });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() and attaches req.user if ban has already expired", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24); // 1 day ago

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-abc" });
    prisma.user.findUnique.mockResolvedValue({
      ...MOCK_DB_USER,
      bannedRecord: {
        reason:      "Old ban",
        bannedUntil: pastDate, // already expired
      },
    });

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
  });

  test("calls next() and attaches req.user for a valid, non-banned user", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-abc" });
    prisma.user.findUnique.mockResolvedValue(MOCK_DB_USER);

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(MOCK_DB_USER);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("returns 500 when Prisma throws a database connection error", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-abc" });
    // Simulate a database crash (NOT a firebase auth error)
    prisma.user.findUnique.mockRejectedValue(new Error("Cannot connect to database"));

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("internal server"),
    }));
    expect(next).not.toHaveBeenCalled();
  });
});


// ════════════════════════════════════════════════════════════════════════════
//  authorize middleware
// ════════════════════════════════════════════════════════════════════════════
describe("authorize middleware", () => {

  test("returns 401 when req.user is not set (authenticate was skipped)", () => {
    const { req, res, next } = makeReqResNext({}, undefined); // no user on req

    authorize("ADMIN")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when user role is not in the allowed list", () => {
    const { req, res, next } = makeReqResNext({}, { ...MOCK_DB_USER, role: "USER" });

    authorize("ADMIN")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "You do not have permission to perform this action.",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() when user role IS in the allowed list", () => {
    const { req, res, next } = makeReqResNext({}, MOCK_ADMIN_USER);

    authorize("ADMIN", "MODERATOR")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("calls next() when multiple roles allowed and user has one of them", () => {
    const { req, res, next } = makeReqResNext({}, { ...MOCK_DB_USER, role: "MODERATOR" });

    authorize("ADMIN", "MODERATOR")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});


// ════════════════════════════════════════════════════════════════════════════
//  requirePremium middleware
// ════════════════════════════════════════════════════════════════════════════
describe("requirePremium middleware", () => {

  test("returns 401 when req.user is not set", () => {
    const { req, res, next } = makeReqResNext({}, undefined);

    requirePremium(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when user is not premium and not an ADMIN", () => {
    const { req, res, next } = makeReqResNext({}, MOCK_DB_USER); // isPremium: false, role: USER

    requirePremium(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "This feature requires a premium subscription.",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() when user isPremium is true", () => {
    const { req, res, next } = makeReqResNext({}, MOCK_PREMIUM_USER);

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("calls next() when user is an ADMIN even if not premium", () => {
    const { req, res, next } = makeReqResNext({}, MOCK_ADMIN_USER); // isPremium: false, role: ADMIN

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});


// ════════════════════════════════════════════════════════════════════════════
//  optionalAuth middleware
// ════════════════════════════════════════════════════════════════════════════
describe("optionalAuth middleware", () => {

  test("calls next() without setting req.user when no Authorization header", async () => {
    const { req, res, next } = makeReqResNext({});

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  test("calls next() silently when the token is invalid (no error thrown to client)", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer bad-token" });

    admin.auth().verifyIdToken.mockRejectedValue(new Error("Invalid token"));

    await optionalAuth(req, res, next);

    // Should silently continue, not return 401
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test("attaches req.user when a valid token matches a Postgres user", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-abc" });
    prisma.user.findUnique.mockResolvedValue(MOCK_DB_USER);

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(MOCK_DB_USER);
  });

  test("calls next() without req.user when token is valid but no Postgres user found", async () => {
    const { req, res, next } = makeReqResNext({ authorization: "Bearer valid-token" });

    admin.auth().verifyIdToken.mockResolvedValue({ uid: "firebase-uid-no-user" });
    prisma.user.findUnique.mockResolvedValue(null); // not in DB

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });
});
