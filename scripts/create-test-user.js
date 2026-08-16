require("dotenv").config();
const admin = require("../src/config/firebase");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyB6USM4YgQdUC9o1KBPIKCr9-bMnARNOdo"; // Fallback to your known key
const TEST_EMAIL = "postman.qa.tester@easyblogger.com";
const TEST_PASSWORD = "Password123!";

async function createTestUser() {
  try {
    console.log("🛠️  Creating safe Test User for Postman...");

    // 1. Delete the user if they already exist from a previous test
    try {
      const existingUser = await admin.auth().getUserByEmail(TEST_EMAIL);
      await admin.auth().deleteUser(existingUser.uid);
      await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
      console.log("🧹 Cleaned up old test user data.");
    } catch (e) {
      // It's okay if they don't exist yet
    }

    // 2. Create the user in Firebase
    const userRecord = await admin.auth().createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      displayName: "Postman QA Tester",
    });

    // We skip Prisma creation so you can test /auth/register or /auth/sync in Postman!
    console.log(`✅ Firebase User Created! Email: ${TEST_EMAIL}`);

    // 4. Generate the JWT Token for Postman
    const customToken = await admin.auth().createCustomToken(userRecord.uid);
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      }
    );

    const data = await response.json();
    
    // Write token to a file to avoid terminal copying issues
    const fs = require('fs');
    fs.writeFileSync('postman_token.txt', data.idToken);

    console.log("\n═══════════════════════════════════════════════════");
    console.log("  ✅ YOUR SAFE TEST TOKEN HAS BEEN SAVED TO:");
    console.log("  📄 postman_token.txt (in your backend folder)");
    console.log("═══════════════════════════════════════════════════\n");

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

createTestUser();
