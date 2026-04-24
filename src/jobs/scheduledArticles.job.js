//src/jobs/scheduledArticles.job.js
const cron = require("node-cron");
const prisma = require("../config/prisma");

const SCHEDULED_ARTICLE_BATCH_SIZE = 50;

function buildPublishedArticleData() {
  return {
    status: "PUBLISHED",
    publishedAt: new Date(),
    scheduledAt: null,
    editingBackupTitle: null,
    editingBackupContent: null,
    editingBackupCoverImage: null,
    editingStartedAt: null,
  };
}

async function processScheduledArticles() {
  const now = new Date();

  try {
    const dueArticles = await prisma.article.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: {
          lte: now,
        },
      },
      orderBy: {
        scheduledAt: "asc",
      },
      take: SCHEDULED_ARTICLE_BATCH_SIZE,
      select: {
        id: true,
        authorId: true,
        status: true,
        scheduledAt: true,
      },
    });

    if (dueArticles.length === 0) {
      return;
    }

    for (const article of dueArticles) {
      await prisma.$transaction(async (tx) => {
        const updatedArticle = await tx.article.updateMany({
          where: {
            id: article.id,
            status: "SCHEDULED",
            scheduledAt: {
              lte: now,
            },
          },
          data: buildPublishedArticleData(),
        });

        if (updatedArticle.count === 0) {
          return;
        }

        await tx.userStats.upsert({
          where: {
            userId: article.authorId,
          },
          update: {
            articleCount: {
              increment: 1,
            },
          },
          create: {
            userId: article.authorId,
            articleCount: 1,
          },
        });
      });
    }

    console.log(`Published ${dueArticles.length} scheduled article(s).`);
  } catch (error) {
    console.error("Failed to process scheduled articles:", error.message);
  }
}

cron.schedule("* * * * *", processScheduledArticles);

module.exports = {
  processScheduledArticles,
};