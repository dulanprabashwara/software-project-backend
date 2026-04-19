const admin = require('firebase-admin');

// Ensure firebase-admin is initialized somewhere in your app!
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: "No token provided" });
  }

  // ✅ FIXED: Get the string at index 1 of the array
  const token = authHeader.split(' '); 

  try {
    // ✅ FIXED: Use Firebase Admin to verify Google's signature
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // This gives you the firebase UID and email
    req.user = decodedToken; 
    next();
  } catch (error) {
    console.error("Token Verification Error:", error.message);
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};

module.exports = { verifyToken };