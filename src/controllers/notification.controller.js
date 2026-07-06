//manage notifications
const notificationService = require("../services/notification.service");

//get available notifications
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const notifications = await notificationService.fetchUserNotifications(userId);
    
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error); // Passes the error to your global Express error handler
  }
};

//mark notificatons as read
exports.markAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.body;

    await notificationService.deleteNotifications(userId, notificationId);
    
    res.status(200).json({ success: true, message: "Deleted" });
  } catch (error) {
    next(error);
  }
};