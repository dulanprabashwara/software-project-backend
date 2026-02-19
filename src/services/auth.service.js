const prisma = require("../config/prisma");
const admin = require("../config/firebase");
const ApiError = require("../utils/ApiError");

/**
 * Register a new user — syncs Firebase user to our local database.
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
 * Sync an existing Firebase user with our database (login flow).
 * Creates the user if they don't exist yet (first-time social login).
 */
const syncUser = async (firebaseUid) => {
  let user = await prisma.user.findUnique({
    where: { firebaseUid },
    include: { stats: true, bannedRecord: true },
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
      include: { stats: true },
    });
  }

  // Update online status
  await prisma.user.update({
    where: { id: user.id },
    data: { isOnline: true, lastSeen: new Date() },
  });

  return user;
};

module.exports = { registerUser, syncUser };
