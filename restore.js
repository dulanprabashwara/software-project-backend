const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

// Regex to detect ISO date strings in the JSON backup
const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

async function restore() {
  // Read file
  const rawData = fs.readFileSync('full_database_backup.json', 'utf8');
  
  // Use a reviver function to turn date strings back into native Date objects
  const backup = JSON.parse(rawData, (key, value) => {
    if (typeof value === 'string' && isoDateRegex.test(value)) {
      return new Date(value);
    }
    return value;
  });
  
  const tables = backup.tables;

  console.log('--- 📥 Starting Database Restoration 📥 ---');

  const orderedTables = [
    // --- LEVEL 0: Independent Tables ---
    { key: 'admin_dashboard', model: 'adminDashboard' },
    { key: 'ai_config', model: 'aiConfig' },
    { key: 'trending_topics', model: 'trendingTopic' },
    { key: 'offers', model: 'offer' },
    { key: 'scraping_sources', model: 'scrapingSource' },
    { key: 'scraping_sessions', model: 'scrapingSession' },
    { key: 'users', model: 'user' },
    { key: 'support_requests', model: 'supportRequest' },

    // --- LEVEL 1: First-Degree Dependencies ---
    { key: 'articles', model: 'article' },
    { key: 'follows', model: 'follow' },
    { key: 'messages', model: 'message' },
    { key: 'user_stats', model: 'userStats' },
    { key: 'banned_users', model: 'bannedUser' },
    { key: 'audit_logs', model: 'auditLog' },
    { key: 'stories', model: 'story' },
    { key: 'subscriptions', model: 'subscription' },
    { key: 'scraping_logs', model: 'scrapingLog' },
    { key: 'scraped_articles', model: 'scrapedArticle' },
    { key: 'keyword_scraping_stats', model: 'categoryScrapingStats' }, // FIXED
    { key: 'wordpress_connections', model: 'wordPressConnection' },
    { key: 'linkedin_connections', model: 'linkedInConnection' },
    { key: 'user_sessions', model: 'userSession' },

    // --- LEVEL 2: Second-Degree Dependencies ---
    { key: 'article_ratings', model: 'articleRating' },
    { key: 'article_shares', model: 'articleShare' },
    { key: 'saved_articles', model: 'savedArticle' },
    { key: 'read_history', model: 'readHistory' },
    { key: 'notifications', model: 'notification' },
    { key: 'reported_articles', model: 'reportedArticle' },
    { key: 'ai_article_logs', model: 'ai_article_logs' },
    { key: 'wordpress_publish_jobs', model: 'wordPressPublishJob' },
    { key: 'linkedin_publish_jobs', model: 'linkedInPublishJob' },
    { key: 'article_interactions', model: 'articleInteractions' }, // ADDED
    
    // Comments go last due to self-referencing
    { key: 'comments', model: 'comment' } 
  ];

  try {
    for (const item of orderedTables) {
      let dataToInsert = tables[item.key];

      if (dataToInsert && dataToInsert.length > 0) {
        console.log(`📦 Restoring: ${item.key} (${dataToInsert.length} records)...`);

        if (item.key === 'comments') {
          dataToInsert = dataToInsert.sort((a, b) => {
            if (!a.parentId && b.parentId) return -1;
            if (a.parentId && !b.parentId) return 1;
            return new Date(a.createdAt) - new Date(b.createdAt);
          });
        }

        if (item.key === 'ai_article_logs') {
          dataToInsert = dataToInsert.map(log => {
            const { savedToDraftId, ...rest } = log; 
            return {
              ...rest,
              linkedArticleId: savedToDraftId 
            };
          });
        }

        await prisma[item.model].createMany({
          data: dataToInsert,
          skipDuplicates: true 
        });
      }
    }

    console.log('\n' + '⭐'.repeat(20));
    console.log('✅ DATABASE FULLY RESTORED');
    console.log('⭐'.repeat(20));

  } catch (error) {
    console.error('\n❌ RESTORE FAILED:', error);
  } finally {
    await prisma.$disconnect();
    console.log('--- Database Connection Closed ---');
  }
}

restore();