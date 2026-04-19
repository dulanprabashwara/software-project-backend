// 1. THIS LINE IS MISSING OR BROKEN
const prisma = require("../config/prisma"); 

exports.getArticleById = async (req, res) => {
  const { id } = req.query; 

  try {
    if (!id) {
      return res.status(400).json({ error: "Article ID is required" });
    }

    // Now that 'prisma' is defined, this will work
    const article = await prisma.article.findUnique({
      where: { id: id },
      include: {
        author: {
          select: {
            displayName: true,
            username: true,
            avatarUrl: true,
            
            bio: true
          }
        },
        _count: {
          select: {  
            comments: true 
          }
        }
      }
    });

    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }

    res.status(200).json(article);

  } catch (error) {
    console.error("ARTICLE READ ERROR:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};