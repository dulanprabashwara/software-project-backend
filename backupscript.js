const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

/**
 * Handles JSON stringify for BigInt and Date objects
 */
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
   * Tables extracted from your schema.
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
      
      // Querying with double quotes to ensure compatibility with case-sensitive names in Postgres
      const data = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      
      backupData.tables[table] = data;
      console.log(`✅ ${table}: ${data.length} records extracted.`);
    } catch (err) {
      console.warn(`⚠️  Skip: "${table}" (Table may not exist in DB or naming mismatch).`);
    }
  }

  try {
    // 1. Get the ISO string: "2026-04-23T06:56:31.963Z"
    // 2. Replace 'T' with an underscore: "2026-04-23_06:56:31.963Z"
    // 3. Replace all ':' with hyphens: "2026-04-23_06-56-31.963Z"
    // 4. Split at the period and take the first part to remove milliseconds: "2026-04-23_06-56-31"
    const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.');
    const fileName = `backup_${timestamp}.json`;
    
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