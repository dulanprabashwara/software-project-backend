const prisma = require("../config/prisma");
const admin = require("../config/firebase");
const ApiError = require("../utils/ApiError");

/**

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
  sign up using google,facebook
 */
const syncUser = async (firebaseUid) => {
  //check if user is exist in database
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
    //create user in database
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
