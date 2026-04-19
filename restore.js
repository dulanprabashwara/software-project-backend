const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function restore() {
  const rawData = fs.readFileSync('full_database_backup.json', 'utf8');
  const backup = JSON.parse(rawData);
  const tables = backup.tables;

  console.log('--- 📥 Starting Full 28-Table Restoration 📥 ---');

  try {
    // 1. PRIMARY TABLES (Must come first)
    if (tables.users?.length) {
      console.log('Restoring: users...');
      await prisma.user.createMany({ data: tables.users });
    }

    if (tables.articles?.length) {
      console.log('Restoring: articles (Transforming likeCount)...');
      const transformedArticles = tables.articles.map(art => {
        const { likeCount, ...rest } = art;
        return {
          ...rest,
          ratingCount: likeCount || 0,
          averageRating: likeCount > 0 ? 5.0 : 0.0
        };
      });
      await prisma.article.createMany({ data: transformedArticles });
    }

    // 2. TRANSFORMED TABLES
    if (tables.article_likes?.length) {
      console.log('Restoring: article_likes -> ArticleRating...');
      const ratings = tables.article_likes.map(like => ({
        id: like.id, userId: like.userId, articleId: like.articleId,
        score: 5, createdAt: like.createdAt
      }));
      await prisma.articleRating.createMany({ data: ratings });
    }

    if (tables.user_stats?.length) {
      console.log('Restoring: user_stats (Cleaning totalLikes)...');
      const cleanedStats = tables.user_stats.map(stat => {
        const { totalLikes, ...rest } = stat;
        return { ...rest, averageRating: 0.0 };
      });
      await prisma.userStats.createMany({ data: cleanedStats });
    }

    // 3. REMAINING TABLES (Automated Loop)
    // Mapping: Backup Table Name (JSON key) -> Prisma Model Name (camelCase)
    const remainingMapping = [
      { key: 'comments', model: 'comment' },
      { key: 'article_shares', model: 'articleShare' },
      { key: 'saved_articles', model: 'savedArticle' },
      { key: 'read_history', model: 'readHistory' },
      { key: 'follows', model: 'follow' },
      { key: 'stories', model: 'story' },
      { key: 'messages', model: 'message' },
      { key: 'notifications', model: 'notification' },
      { key: 'reported_articles', model: 'reportedArticle' },
      { key: 'banned_users', model: 'bannedUser' },
      { key: 'audit_logs', model: 'auditLog' },
      { key: 'admin_dashboard', model: 'adminDashboard' },
      { key: 'ai_config', model: 'aiConfig' },
      { key: 'trending_topics', model: 'trendingTopic' },
      { key: 'offers', model: 'offer' },
      { key: 'subscriptions', model: 'subscription' },
      { key: 'ai_article_logs', model: 'ai_article_logs' },
      { key: 'scraping_sources', model: 'scrapingSource' },
      { key: 'scraping_sessions', model: 'scrapingSession' },
      { key: 'scraping_logs', model: 'scrapingLog' },
      { key: 'scraped_articles', model: 'scrapedArticle' },
      { key: 'keyword_scraping_stats', model: 'keywordScrapingStats' },
      { key: 'wordpress_connections', model: 'wordPressConnection' },
      { key: 'wordpress_publish_jobs', model: 'wordPressPublishJob' }
    ];

    for (const item of remainingMapping) {
      if (tables[item.key] && tables[item.key].length > 0) {
        console.log(`Restoring: ${item.key}...`);
        await prisma[item.model].createMany({ 
          data: tables[item.key],
          skipDuplicates: true 
        });
      }
    }

    console.log('\n✅ DATABASE FULLY RESTORED');

  } catch (error) {
    console.error('\n❌ RESTORE FAILED:', error);
  } finally {
    await prisma.$disconnect();
  }
}

restore();