require("dotenv").config();

const fs = require("fs");
const admin = require("../src/config/firebase");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const FIREBASE_API_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
  "AIzaSyB6USM4YgQdUC9o1KBPIKCr9-bMnARNOdo";
const TEST_EMAIL = "postman.chat.receiver@easyblogger.com";

async function createChatReceiver() {
  try {
    console.log("Creating safe chat receiver for Postman...");

    try {
      const existingUser = await admin.auth().getUserByEmail(TEST_EMAIL);
      await admin.auth().deleteUser(existingUser.uid);
      await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
      console.log("Cleaned up old chat receiver data.");
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }

    const userRecord = await admin.auth().createUser({
      email: TEST_EMAIL,
      password: "Password123!",
      displayName: "Postman Chat Receiver",
    });
    const customToken = await admin.auth().createCustomToken(userRecord.uid);
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      },
    );
    const data = await response.json();

    if (!response.ok || !data.idToken) {
      throw new Error(data.error?.message || "Failed to create Firebase ID token.");
    }

    fs.writeFileSync("postman_receiver_token.txt", data.idToken);
    console.log(`Firebase chat receiver created: ${TEST_EMAIL}`);
    console.log("Token saved to postman_receiver_token.txt");
  } catch (error) {
    console.error("Error:", error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

createChatReceiver();
