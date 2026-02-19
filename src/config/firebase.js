const admin = require("firebase-admin");

/**
 * Initialize Firebase Admin SDK.
 * Uses environment variables for credentials instead of a JSON key file
 * so we never commit secrets to source control.
 */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // The private key comes as a string with escaped newlines
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

module.exports = admin;
