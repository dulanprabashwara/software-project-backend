// src/jobs/trendingScore.job.js
const cron = require("node-cron");
const prisma = require("../config/prisma");

const calculateAndSaveScores = async () => {
  console.log("Starting trending score recalculation...");

  try {
    // 1. Fetch articles (Optional: You can add a date filter here so you don't calculate 10-year-old articles)
    const articles = await prisma.article.findMany({
      where: { status: "PUBLISHED" },
      select: { 
        id: true, 
        createdAt: true, 
        readCount: true, 
        commentCount: true,
        ratingCount: true
    }  
    });

    // 2. Loop through each article and calculate its new score
    for (const article of articles) {
      const viewsWeight = 1;       // 1 point per view
      const commentsWeight = 5;    // 5 points per comment
      const rateWeight = 3;
      const affect = 1.2;         // How fast old posts lose their score

      // Calculate age in hours
      const ageInMs = new Date() - new Date(article.createdAt);
      const ageInHours = ageInMs / (1000 * 60 * 60);

      // The Gravity Formula
      const interactions = (article.readCount * viewsWeight) + (article.commentCount * commentsWeight)+ (article.ratingCount*rateWeight);
      const penalty = Math.pow(ageInHours, affect);
      const newScore = interactions / penalty;

      // 3. Update the database
      await prisma.article.update({
        where: { id: article.id },
        data: { trendingScore: newScore,
                updatedAt: article.updatedAt
         }
      });
    }

    console.log(`Successfully updated trending scores for ${articles.length} articles.`);
  } catch (error) {
    console.error("Error updating trending scores:", error.message);
  }
};

 
cron.schedule("0 */1 * * *", calculateAndSaveScores);

module.exports = { calculateAndSaveScores };