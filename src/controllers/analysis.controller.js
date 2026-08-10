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
  // For this mock, we will extract actual phrases from the submitted content so you can see the highlights!
  const plainText = htmlContent.replace(/<[^>]+>/g, ' ');
  const words = plainText.split(/\s+/).filter(w => w.trim().length > 0);
  const phrases = [];
  for (let i = 0; i < words.length - 5; i += 6) {
    phrases.push(words.slice(i, i + 4).join(' ')); // Grab 4-word phrases
  }

  if (type === "ai" || type === "both") {
    aiScore = Math.floor(Math.random() * 40) + 20; // 20-60%
    if (phrases[0]) highlights.push({ text: phrases[0], type: "AI" });
    if (phrases[2]) highlights.push({ text: phrases[2], type: "AI" });
  }

  if (type === "plagiarism" || type === "both") {
    plagiarismScore = Math.floor(Math.random() * 30) + 5; // 5-35%
    if (phrases[1]) highlights.push({ text: phrases[1], type: "PLAGIARISM" });
    if (phrases[3]) highlights.push({ text: phrases[3], type: "PLAGIARISM" });
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
