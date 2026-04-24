const prisma = require("../config/prisma");
const admin = require("../config/firebase");
const ApiError = require("../utils/ApiError");

/**
 * @function registerUser
 * @description
 * Creates a new user record in Postgres mapped to their newly generated Firebase identity.
 */
const registerUser = async ({
  firebaseUid,
  email,
  username,
  displayName,
  avatarUrl,
}) => {
  // Check if user already exists
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ firebaseUid }, { email }, { username }],
    },
  });

  if (existing) {
    if (existing.firebaseUid === firebaseUid) {
      throw ApiError.conflict("User already registered.");
    }
    if (existing.email === email) {
      throw ApiError.conflict("Email already in use.");
    }
    if (existing.username === username) {
      throw ApiError.conflict("Username already taken.");
    }
  }

  const user = await prisma.user.create({
    data: {
      firebaseUid,
      email,
      username,
      displayName,
      avatarUrl,
      stats: {
        create: {}, // Initialize empty stats record
      },
    },
    include: { stats: true },
  });

  return user;
};

/**
 * @function syncUser
 * @description
 * Synchronizes a Firebase login event with the local Postgres database.
 * WHY: If a user logs in via a social provider (Google, GitHub) for the very first time,
 * they won't exist in Postgres. This function cleanly handles the "Upsert" logic by fetching
 * their fresh Firebase profile and cleanly auto-generating a Postgres record for them dynamically.
 *
 * @param {string} firebaseUid - The cryptographically verified Firebase UID.
 * @returns {Promise<Object>} The deeply nested Prisma User object including stats, counts, and ban data.
 */
const syncUser = async (firebaseUid) => {
  let user = await prisma.user.findUnique({
    where: { firebaseUid },
    include: {
      stats: true,
      bannedRecord: true,
      _count: {
        select: {
          followers: true,
          following: true,
          articles: { where: { status: "PUBLISHED" } },
        },
      },
    },
  });

  if (!user) {
    // Fetch user info from Firebase to auto-create
    const firebaseUser = await admin.auth().getUser(firebaseUid);

    user = await prisma.user.create({
      data: {
        firebaseUid,
        email: firebaseUser.email,
        username:
          firebaseUser.email.split("@")[0] +
          "_" +
          Math.random().toString(36).substring(2, 6),
        displayName: firebaseUser.displayName || null,
        avatarUrl: firebaseUser.photoURL || null,
        stats: { create: {} },
      },
      include: {
        stats: true,
        bannedRecord: true,
        _count: {
          select: {
            followers: true,
            following: true,
            articles: { where: { status: "PUBLISHED" } },
          },
        },
      },
    });
  }

  return user;
};

module.exports = { registerUser, syncUser };
