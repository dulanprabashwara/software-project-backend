// tests/auth/auth.service.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for src/services/auth.service.js
//   • registerUser – creates a new Postgres user mapped to a Firebase UID
//   • syncUser     – fetches or auto-creates a Postgres user on social login
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Swap real Firebase Admin and Prisma with fakes ────────────────────────
jest.mock("../../src/config/firebase", () => require("../mocks/firebase.mock"));
jest.mock("../../src/config/prisma",   () => require("../mocks/prisma.mock.auth"));

const admin  = require("../../src/config/firebase");
const prisma = require("../../src/config/prisma");
const { registerUser, syncUser } = require("../../src/services/auth.service");

// ── 2. Shared test fixtures ───────────────────────────────────────────────────
const VALID_REGISTRATION_DATA = {
  firebaseUid: "firebase-uid-new-001",
  email:       "newuser@example.com",
  username:    "newuser",
  displayName: "New User",
  avatarUrl:   "https://cdn.example.com/avatar.jpg",
};

const MOCK_CREATED_USER = {
  id:          "db-user-id-001",
  ...VALID_REGISTRATION_DATA,
  role:        "USER",
  isPremium:   false,
  stats:       { id: "stats-001", userId: "db-user-id-001" },
  createdAt:   new Date(),
};

const MOCK_EXISTING_USER_FULL = {
  ...MOCK_CREATED_USER,
  bannedRecord: null,
  _count: { followers: 5, following: 3, articles: 12 },
};

beforeEach(() => {
  jest.clearAllMocks();
});


// ════════════════════════════════════════════════════════════════════════════
//  registerUser
// ════════════════════════════════════════════════════════════════════════════
describe("registerUser", () => {

  test("throws a 409 Conflict error when firebaseUid is already registered", async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...MOCK_CREATED_USER,
      firebaseUid: VALID_REGISTRATION_DATA.firebaseUid, // same UID
    });

    await expect(registerUser(VALID_REGISTRATION_DATA))
      .rejects.toMatchObject({ statusCode: 409, message: "User already registered." });

    // Should not attempt to create
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("throws a 409 Conflict error when email is already in use", async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...MOCK_CREATED_USER,
      firebaseUid: "different-firebase-uid", // different UID
      email:       VALID_REGISTRATION_DATA.email, // same email
    });

    await expect(registerUser(VALID_REGISTRATION_DATA))
      .rejects.toMatchObject({ statusCode: 409, message: "Email already in use." });

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("throws a 409 Conflict error when username is already taken", async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...MOCK_CREATED_USER,
      firebaseUid: "different-uid",
      email:       "different@email.com",
      username:    VALID_REGISTRATION_DATA.username, // same username
    });

    await expect(registerUser(VALID_REGISTRATION_DATA))
      .rejects.toMatchObject({ statusCode: 409, message: "Username already taken." });

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("creates and returns a new user when no conflicts exist", async () => {
    // No existing user found
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(MOCK_CREATED_USER);

    const result = await registerUser(VALID_REGISTRATION_DATA);

    // Should have called create with the correct data
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firebaseUid: VALID_REGISTRATION_DATA.firebaseUid,
          email:       VALID_REGISTRATION_DATA.email,
          username:    VALID_REGISTRATION_DATA.username,
        }),
      })
    );

    expect(result).toEqual(MOCK_CREATED_USER);
  });

  test("creates user with stats initialized in the same call (nested create)", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(MOCK_CREATED_USER);

    await registerUser(VALID_REGISTRATION_DATA);

    // Confirm that the stats nested create is present
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stats: { create: {} },
        }),
      })
    );
  });

  test("correctly checks for conflicts using OR (firebaseUid OR email OR username)", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(MOCK_CREATED_USER);

    await registerUser(VALID_REGISTRATION_DATA);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { firebaseUid: VALID_REGISTRATION_DATA.firebaseUid },
            { email: VALID_REGISTRATION_DATA.email },
            { username: VALID_REGISTRATION_DATA.username },
          ],
        },
      })
    );
  });
});


// ════════════════════════════════════════════════════════════════════════════
//  syncUser
// ════════════════════════════════════════════════════════════════════════════
describe("syncUser", () => {

  test("returns the existing Postgres user when they are already in the database", async () => {
    prisma.user.findUnique.mockResolvedValue(MOCK_EXISTING_USER_FULL);

    const result = await syncUser("firebase-uid-abc");

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { firebaseUid: "firebase-uid-abc" },
      })
    );

    // Should NOT reach out to Firebase or create a new user
    expect(admin.auth().getUser).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();

    expect(result).toEqual(MOCK_EXISTING_USER_FULL);
  });

  test("fetches from Firebase and auto-creates a Postgres user for a brand-new social login", async () => {
    // User NOT in our DB yet
    prisma.user.findUnique.mockResolvedValueOnce(null);

    // Firebase returns their profile (e.g., a Google Sign-In user)
    admin.auth().getUser.mockResolvedValue({
      uid:         "firebase-uid-social-001",
      email:       "socialuser@gmail.com",
      displayName: "Social User",
      photoURL:    "https://lh3.googleusercontent.com/photo.jpg",
    });

    // Prisma creates the new user successfully
    const newlyCreatedUser = {
      ...MOCK_EXISTING_USER_FULL,
      id:          "db-new-social-id",
      firebaseUid: "firebase-uid-social-001",
      email:       "socialuser@gmail.com",
    };
    prisma.user.create.mockResolvedValue(newlyCreatedUser);

    const result = await syncUser("firebase-uid-social-001");

    // Firebase getUser MUST have been called
    expect(admin.auth().getUser).toHaveBeenCalledWith("firebase-uid-social-001");
    // Prisma create MUST have been called
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firebaseUid: "firebase-uid-social-001",
          email:       "socialuser@gmail.com",
          displayName: "Social User",
          stats: { create: {} },
        }),
      })
    );

    expect(result).toEqual(newlyCreatedUser);
  });

  test("auto-generates a username from email when displayName is not set", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    admin.auth().getUser.mockResolvedValue({
      uid:         "firebase-uid-no-name",
      email:       "johndoe@example.com",
      displayName: null,    // No display name (e.g., email/password registration)
      photoURL:    null,
    });

    prisma.user.create.mockResolvedValue({ ...MOCK_EXISTING_USER_FULL, id: "db-new-id-no-name" });

    await syncUser("firebase-uid-no-name");

    // Username should be derived from email ("johndoe" + random suffix)
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: expect.stringMatching(/^johndoe_/),  // starts with "johndoe_"
          displayName: null,
          avatarUrl:   null,
        }),
      })
    );
  });

  test("fetches user with full relational data (stats, bannedRecord, _count)", async () => {
    prisma.user.findUnique.mockResolvedValue(MOCK_EXISTING_USER_FULL);

    await syncUser("firebase-uid-abc");

    // Confirm the query includes the necessary relations
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          stats:        true,
          bannedRecord: true,
          _count: expect.objectContaining({
            select: expect.objectContaining({
              followers: true,
              following: true,
            }),
          }),
        }),
      })
    );
  });
});
