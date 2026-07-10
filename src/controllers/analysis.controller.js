/**
 * Controller to handle Plagiarism and AI Detection API calls.
 * This is currently a mock implementation simulating a service like Copyleaks.
 */
exports.checkContent = async (req, res) => {
  try {
  const { htmlContent, type } = req.body;

  if (!htmlContent) {
    return res.status(400).json({
      success: false,
      message: "htmlContent is required for analysis.",
    });
  }

  // TODO: Replace this mock delay with actual Axios/Fetch call to Copyleaks/Originality API
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Mocking the response based on the requested analysis type
  let aiScore = 0;
  let plagiarismScore = 0;
  const highlights = [];

  // In a real API, you'd receive exact string matches or character offsets.
  // We'll return some common letters/words just so the frontend highlighting can be tested visually.
  if (type === "ai" || type === "both") {
    aiScore = Math.floor(Math.random() * 40) + 20; // 20-60%
    highlights.push({ text: "Technology", type: "AI" });
    highlights.push({ text: "design", type: "AI" });
    highlights.push({ text: "article", type: "AI" });
  }

  if (type === "plagiarism" || type === "both") {
    plagiarismScore = Math.floor(Math.random() * 30) + 5; // 5-35%
    highlights.push({ text: "publish", type: "PLAGIARISM" });
    highlights.push({ text: "blog", type: "PLAGIARISM" });
    highlights.push({ text: "test", type: "PLAGIARISM" });
  }

  res.status(200).json({
    success: true,
    data: {
      aiScore,
      plagiarismScore,
      highlights,
      message: "Analysis complete. This is a mocked response."
    },
  });
  } catch (error) {
    console.error("Analysis Controller Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
