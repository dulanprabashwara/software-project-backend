const { PrismaClient } = require("@prisma/client");

/**
 * Singleton PrismaClient instance.
 * Prevents multiple instances during hot-reloading in development.
 *
 * connection_limit=5 keeps the pool within NeonDB free-tier limits (avoids
 * "connection pool timeout" errors). pool_timeout=20 gives extra headroom
 * during brief traffic spikes.
 */

function buildUrl() {
  const base = process.env.DATABASE_URL || "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}connection_limit=5&pool_timeout=20`;
}

/** @type {PrismaClient} */
let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient({
    log: ["error"],
    datasources: { db: { url: buildUrl() } },
  });
} else {
  // In development, reuse the client across hot-reloads
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ["warn", "error"],
      datasources: { db: { url: buildUrl() } },
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
