const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

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
    "wordpress_publish_jobs",
    "article_interactions" 
  ];

  console.log('--- Starting Full Database Backup ---');

  for (const table of tables) {
    try {
      console.log(`Extracting: ${table}...`);
      const data = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      backupData.tables[table] = data;
      console.log(`Success ${table}: ${data.length} records`);
    } catch (err) {
      console.warn(`Skip: "${table}"`);
    }
  }

  try {
    const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.');
    const fileName = `backup_${timestamp}.json`;
    
    fs.writeFileSync(fileName, stringify(backupData));
    
    console.log(`Done! ${fileName} created with ${Object.keys(backupData.tables).length} tables`);
  } catch (err) {
    console.error('Failed to write file:', err);
  }
}

backup()
  .catch(e => console.error('Error:', e))
  .finally(async () => {
    await prisma.$disconnect();
    console.log('Closed connection');
  });