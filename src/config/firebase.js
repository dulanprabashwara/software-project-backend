const admin = require("firebase-admin");

/**
 * @fileoverview Firebase Admin SDK Configuration
 * @description
 * Initializes the Firebase Admin SDK using environment variables.
 
 * @module config/firebase
 * @returns {Object} The initialized firebase-admin instance.
 */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

module.exports = admin;
