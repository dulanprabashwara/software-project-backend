const prisma = require("../config/prisma");

exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { destUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        // Fetch related data for dynamic frontend rendering
        sourceUser: { select: { username: true, displayName: true, avatarUrl: true } },
        sourceArticle: { select: { title: true, id: true } }
      }
    });

    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

// Function name matches what the router will call
exports.markAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.body;

    if (notificationId) {
      await prisma.notification.deleteMany({
        where: { id: notificationId, destUserId: userId },
      });
    } else {
      await prisma.notification.deleteMany({
        where: { destUserId: userId },
      });
    }
    res.status(200).json({ success: true, message: "Deleted" });
  } catch (error) {
    next(error);
  }
};