const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

// High-level wrapper to handle JSON stringify issues with BigInt
const stringify = (obj) =>
  JSON.stringify(
    obj,
    (key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2
  );

async function backup() {
  const backupData = {
    timestamp: new Date().toISOString(),
    tables: {}
  };

  /**
   * Verified table names from your specific schema @@map attributes.
   * Total: 28 Tables.
   */
  const tables = [
    "users",
    "articles",
    "comments",
    "article_ratings",
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
    "ai_article_logs", // Model name used as table name
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
      
      // SQL query wrapped in double quotes to handle Postgres naming conventions
      const data = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      
      backupData.tables[table] = data;
      console.log(`✅ ${table}: ${data.length} records extracted.`);
    } catch (err) {
      // Graceful skip if table is not yet migrated to the DB
      console.warn(`⚠️  Skip: "${table}" (Table may not exist in DB yet).`);
    }
  }

  try {
    const fileName = 'full_database_backup.json';
    fs.writeFileSync(fileName, stringify(backupData));
    
    console.log('\n' + '⭐'.repeat(20));
    console.log(`✅ SUCCESS: ${fileName} created!`);
    console.log(`Total tables captured: ${Object.keys(backupData.tables).length}`);
    console.log('⭐'.repeat(20));
  } catch (fileErr) {
    console.error('❌ Failed to write backup file:', fileErr);
  }
}

backup()
  .catch(e => console.error('❌ Critical Backup Failure:', e))
  .finally(async () => {
    await prisma.$disconnect();
    console.log('--- Database Connection Closed ---');
  });