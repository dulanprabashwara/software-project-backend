const admin = require("firebase-admin");

/**
 * @fileoverview Firebase Admin SDK Configuration
 * @description
 * Initializes the highly-privileged Firebase Admin SDK using environment variables.
 * WHY: This specific initialization strategy prevents committing sensitive JSON key files 
 * to version control while allowing the server to interact with Firebase services (like 
 * token verification) with full administrative privileges.
 * 
 * @module config/firebase
 * @returns {Object} The initialized firebase-admin instance.
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
