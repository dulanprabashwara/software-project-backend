const { PrismaClient } = require("@prisma/client");

/**
 * Singleton PrismaClient instance.
 * Prevents multiple instances during hot-reloading in development.
 */

/** @type {PrismaClient} */
let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient({
    log: ["error"],
  });
} else {
  // In development, reuse the client across hot-reloads
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ["query", "info", "warn", "error"],
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
