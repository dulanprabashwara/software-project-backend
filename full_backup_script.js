const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function backup() {
  const backupData = {
    timestamp: new Date().toISOString(),
    tables: {}
  };

  // These are the actual database table names mapped via @@map in your schema
  const tables = [
    "users", 
    "articles", 
    "comments", 
    "article_likes", 
    "article_shares",
    "saved_articles", 
    "read_history", 
    "follows", 
    "stories", 
    "messages",
    "user_stats", 
    "notifications", 
    "reported_articles", 
    "banned_users",
    "audit_logs", 
    "admin_dashboard", 
    "ai_config", 
    "trending_topics",
    "offers", 
    "subscriptions", 
    "ai_article_logs", 
    "scraping_sources",
    "scraping_sessions", 
    "scraping_logs", 
    "scraped_articles", 
    "keyword_scraping_stats",
    "wordpress_connections", 
    "wordpress_publish_jobs"
  ];

  console.log('--- 🛡️ Starting Full Database Backup 🛡️ ---');

  for (const table of tables) {
    try {
      console.log(`Extracting: ${table}...`);
      // queryRawUnsafe bypasses Prisma Client types to talk directly to the DB
      const data = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      backupData.tables[table] = data;
    } catch (err) {
      console.warn(`⚠️ Warning: Could not backup "${table}". It might be empty or not yet created.`);
    }
  }

  try {
    fs.writeFileSync('full_database_backup.json', JSON.stringify(backupData, null, 2));
    console.log('\n✅ SUCCESS: full_database_backup.json created!');
    console.log(`Total tables processed: ${Object.keys(backupData.tables).length}`);
  } catch (fileErr) {
    console.error('❌ Failed to write backup file:', fileErr);
  }
}

backup()
  .catch(e => console.error('❌ Critical Backup Failure:', e))
  .finally(async () => {
    await prisma.$disconnect();
    console.log('--- Disconnected from Database ---');
  });