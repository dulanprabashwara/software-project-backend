/**
 * Firebase Token Generator for Postman Testing
 * 
 * Uses Firebase Admin SDK to create a custom token,
 * then exchanges it for an ID token via Firebase REST API.
 * 
 * Usage: node scripts/get-token.js
 * 
 * The script will print a valid JWT token that you can
 * copy and paste into Postman's Authorization header.
 */
require("dotenv").config();

const admin = require("../src/config/firebase");

// Your Firebase Web API Key (from frontend .env)
const FIREBASE_API_KEY = "AIzaSyB6USM4YgQdUC9o1KBPIKCr9-bMnARNOdo";

async function getToken() {
  try {
    const targetEmail = process.argv[2];
    let targetUser;

    if (targetEmail) {
      targetUser = await admin.auth().getUserByEmail(targetEmail);
    } else {
      // Step 1: List users and pick the first one
      const listResult = await admin.auth().listUsers(1);

      if (listResult.users.length === 0) {
        console.error("No users found in Firebase. Please register a user first.");
        process.exit(1);
      }
      targetUser = listResult.users[0];
    }

    console.log(`\n🔑 Generating token for: ${targetUser.email} (UID: ${targetUser.uid})\n`);

    // Step 2: Create a custom token using Admin SDK
    const customToken = await admin.auth().createCustomToken(targetUser.uid);

    // Step 3: Exchange custom token for an ID token via Firebase REST API
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error("Firebase REST API Error:", data.error.message);
      process.exit(1);
    }

    console.log("═══════════════════════════════════════════════════");
    console.log("  ✅ YOUR FIREBASE ID TOKEN (copy this entire string):");
    console.log("═══════════════════════════════════════════════════\n");
    console.log(data.idToken);
    console.log("\n═══════════════════════════════════════════════════");
    console.log(`  ⏰ Expires in: ${data.expiresIn} seconds (1 hour)`);
    console.log("  📋 Copy the token above and paste it into Postman");
    console.log("═══════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

getToken();
