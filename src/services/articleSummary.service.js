const prisma = require("../config/prisma"); 

const generateSummary = async (articleId, userId) => {
  // 1. Find the article to get the content and verify ownership
  const article = await prisma.article.findUnique({
    where: 
          { id: articleId,
           

           },
    select: { 
      authorId: true, 
      content: true 
    }
  });

  if (!article) {
    throw new Error("Article not found.");
  }

  // 2. Security Check: Only the author can modify their own article
  if (article.authorId !== userId) {
    throw new Error("Unauthorized: You do not have permission to modify this article.");
  }

  // 3. Extract the first 200 words
  // First, strip out any HTML tags (e.g., <p>, <strong>) so they aren't counted as words
  const cleanContent = article.content.replace(/<[^>]*>?/gm, '');
  
  // Split the cleaned text into an array of words based on spaces/newlines
  const wordsArray = cleanContent.trim().split(/\s+/);
  
  // Grab the first 200 words and join them back into a single string
  const summaryText = wordsArray.slice(0, 200).join(" ");

  // If the article has more than 200 words, append an ellipsis (...)
  const finalSummary = wordsArray.length > 200 ? `${summaryText}...` : summaryText;

  // 4. Update the article's summary field in the database
  const updatedArticle = await prisma.article.update({
    where: { id: articleId },
    data: { 
      summary: finalSummary 
    },
  });

  return updatedArticle;
};

module.exports = {
  generateSummary,
};