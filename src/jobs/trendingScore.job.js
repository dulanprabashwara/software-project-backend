 const cron = require("node-cron");
const prisma = require("../config/prisma");

const calculateAndSaveScores = async () => {
  console.log("Starting trending score recalculation...");

  try {
    // Fetch articles 
    const articles = await prisma.article.findMany({
      where: { status: "PUBLISHED" },
      select: { 
        id: true, 
        createdAt: true, 
        updatedAt: true,
        readCount: true, 
        commentCount: true,
        ratingCount: true
    }  
    });

    //Loop through and calculate score
    for (const article of articles) {
      const viewsWeight = 1;       // 1 point per view
      const commentsWeight = 5;    // 5 points per comment
      const rateWeight = 3;        // 3 points per rating (score won't matter)
      const affect = 1.2;         // How fast old posts lose their score

      // Calculate age in hours
      const ageInMs = new Date().getTime() - new Date(article.createdAt).getTime();
      const ageInHours = ageInMs / (1000 * 60 * 60);

      // interaction score
      const interactions = (article.readCount * viewsWeight) + (article.commentCount * commentsWeight)+ (article.ratingCount*rateWeight);
      // calculate penalty with age
      const penalty = Math.pow(ageInHours + 2, affect);
      const newScore = interactions / penalty || 0;

      // Update the database
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

 //min,hou,daymonth,dayweek
cron.schedule("0 */1 * * *", calculateAndSaveScores); //run once evry hpur

module.exports = { calculateAndSaveScores };