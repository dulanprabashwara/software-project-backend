const supportService = require("../services/support.service");

const createSupportRequest = async (req, res, next) => {
  try {
    const { email, problem } = req.body;
    
    if (!email || !problem) {
      return res.status(400).json({ error: "Email and problem are required" });
    }

    const supportRequest = await supportService.createSupportRequest({ email, problem });
    
    res.status(201).json({
      success: true,
      message: "Support request created successfully",
      data: supportRequest,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSupportRequest,
};
