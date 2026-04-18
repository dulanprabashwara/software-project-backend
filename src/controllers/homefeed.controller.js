// backend/controllers/homefeed.controller.js
const prisma = require("../config/prisma");

exports.getFeed = async (req, res) => {
  try {
    // We remove EVERYTHING except the basic findMany
    const articles = await prisma.article.findMany({
      orderBy: { createdAt: "desc" }
    });

    console.log("SUCCESS: Found in DB ->", articles.length);
    res.status(200).json({ articles });
  } catch (error) {
    console.error("PRISMA ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};