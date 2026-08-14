const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Logs a major event to the Platform Pulse dashboard feed.
 * 
 * @param {string} type - e.g., "NEW_ARTICLE", "USER_UPGRADE", "NEW_USER"
 * @param {string} message - e.g., "Dulan just published a new article!"
 */
const logPlatformEvent = async (type, message) => {
  try {
    await prisma.platformEvent.create({
      data: {
        type,
        message
      }
    });
  } catch (error) {
    console.error("Failed to log platform event:", error);
  }
};

module.exports = {
  logPlatformEvent
};