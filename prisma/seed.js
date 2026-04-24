// const { PrismaClient } = require("@prisma/client");
// const fs = require("fs");
// const path = require("path");

// const prisma = new PrismaClient();

// async function main() {
//   console.log("🌱 Starting Full Restore Seed...");

//   const backupPath = path.join(__dirname, "../full_database_backup.json");

//   if (!fs.existsSync(backupPath)) {
//     console.error("❌ Error: full_database_backup.json not found!");
//     process.exit(1);
//   }

//   const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
//   const tables = backup.tables;

//   /**
//    * THE MASTER ORDER (28 Tables)
//    * Sorted by dependency level to satisfy Foreign Key constraints.
//    */
//   const seedOrder = [
//     // Level 0: Independence
//     { jsonKey: "users", model: "user" },
//     { jsonKey: "offers", model: "offer" },
//     { jsonKey: "ai_config", model: "aiConfig" },
//     { jsonKey: "admin_dashboard", model: "adminDashboard" },
//     { jsonKey: "trending_topics", model: "trendingTopic" },
//     { jsonKey: "scraping_sources", model: "scrapingSource" },

//     // Level 1: Depends on Users/Level 0
//     { jsonKey: "articles", model: "article" },
//     { jsonKey: "user_stats", model: "userStats" },
//     { jsonKey: "subscriptions", model: "subscription" },
//     { jsonKey: "follows", model: "follow" },
//     { jsonKey: "stories", model: "story" },
//     { jsonKey: "messages", model: "message" },
//     { jsonKey: "banned_users", model: "bannedUser" },
//     { jsonKey: "audit_logs", model: "auditLog" },
//     { jsonKey: "wordpress_connections", model: "wordPressConnection" },
//     { jsonKey: "scraping_sessions", model: "scrapingSession" },

//     // Level 2: Depends on Articles/Sessions/Connections
//     { jsonKey: "comments", model: "comment" },
//     { jsonKey: "article_ratings", model: "articleRating" },
//     { jsonKey: "article_shares", model: "articleShare" },
//     { jsonKey: "saved_articles", model: "savedArticle" },
//     { jsonKey: "read_history", model: "readHistory" },
//     { jsonKey: "notifications", model: "notification" },
//     { jsonKey: "reported_articles", model: "reportedArticle" },
//     { jsonKey: "ai_article_logs", model: "ai_article_logs" },
//     { jsonKey: "wordpress_publish_jobs", model: "wordPressPublishJob" },
//     { jsonKey: "scraping_logs", model: "scrapingLog" },
//     { jsonKey: "scraped_articles", model: "scrapedArticle" },
//     { jsonKey: "keyword_scraping_stats", model: "keywordScrapingStats" }
//   ];

//   console.log(`📦 Backup found. Timestamp: ${backup.timestamp}`);

//   for (const table of seedOrder) {
//     const data = tables[table.jsonKey];

//     if (!data || data.length === 0) {
//       console.log(`⏩ Skipping ${table.jsonKey} (no data).`);
//       continue;
//     }

//     console.log(`📡 Restoring ${data.length} records into ${table.model}...`);

//     for (const record of data) {
//       try {
//         await prisma[table.model].upsert({
//           where: { id: record.id },
//           update: record,
//           create: record,
//         });
//       } catch (err) {
//         // Warning: This helps identify if a specific record has a broken relation
//         console.warn(`⚠️ Failed record in ${table.model}: ${err.message}`);
//       }
//     }
//   }

//   console.log("\n✅ ALL 28 TABLES PROCESSED!");
// }

// main()
//   .catch((e) => {
//     console.error("❌ Restore failed:", e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });