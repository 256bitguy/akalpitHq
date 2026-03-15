const mongoose       = require('mongoose');
// const admin          = require('../config/firebase');
// const User           = require('../modules/user/user.model');
// const Subscription   = require('./subscription.model');
// const Notification   = require('./notification.model');
// const ApiError       = require('../utils/ApiError');
// const asyncHandler   = require('');
const { subscribeToTopic, topicFor } = require('../../utils/notify.js');
const Subscription = require('../subscription/subscription.model.js');
const NotificationModel = require('./notification.model.js');
const userModel = require('../user/user.model.js');
const ApiError = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/asyncHandler.js');

/*
 * NOTIFICATION CONTROLLER
 * ──────────────────────────────────────────────────────────────────
 * HTTP endpoints only. No FCM sending logic lives here.
 * All sending goes through utils/notify.js.
 *
 * ROUTES:
 *   PUT    /api/notifications/token            registerFcmToken
 *   DELETE /api/notifications/token            unregisterFcmToken
 *   POST   /api/notifications/recover          recoverMySubscriptions
 *   GET    /api/notifications/subscriptions    getMySubscriptions
 *   GET    /api/notifications                  getMyNotifications
 *   PATCH  /api/notifications/read-all         markAllAsRead
 *   PATCH  /api/notifications/:id/read         markOneAsRead
 *   DELETE /api/notifications/:id              deleteNotification
 */

// ── Internal: full topic recovery for one user ────────────────────
// Resubscribes a user to all their active topics in Firebase.
// Called automatically on every token registration change.
async function resubscribeAllTopics(userId, newToken) {
  const activeSubs = await Subscription.find({ userId, isActive: true }).lean();
  if (!activeSubs.length) return { restored: 0, failed: 0, total: 0 };

  const results = await Promise.allSettled(
    activeSubs.map((sub) =>
      admin.messaging().subscribeToTopic(newToken, sub.topic)
    )
  );

  // Update token snapshot in one write
  await Subscription.updateMany(
    { userId, isActive: true },
    { $set: { deviceToken: newToken } }
  );

  return {
    restored: results.filter((r) => r.status === 'fulfilled').length,
    failed:   results.filter((r) => r.status === 'rejected').length,
    total:    activeSubs.length,
  };
}

/*
 * REGISTER FCM TOKEN
 * PUT /api/notifications/token
 * Body: { fcmToken: string }
 *
 * Call on every app launch AND after login.
 * Detects token change → triggers full topic recovery automatically.
 * On first-time registration → auto-subscribes user to their
 * role topic and team_all topic.
 */
const registerFcmToken = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { fcmToken } = req.body;

  if (!fcmToken?.trim()) throw new ApiError(400, 'fcmToken is required');

  const user = await userModel.findById(userId).select('fcmToken role');
  if (!user) throw new ApiError(404, 'User not found');

  const isNewToken = user.fcmToken !== fcmToken;

  // Always overwrite — single token per user
  user.fcmToken = fcmToken;
  await user.save({ validateBeforeSave: false });

  let recovery = null;

  if (isNewToken || !user.fcmToken) {
    // ── Auto-subscribe to role topic + team_all if no existing subs ──
    const existingSubs = await Subscription.countDocuments({ userId, isActive: true });

    if (existingSubs === 0) {
      // First time — bootstrap role + team subscriptions
      await Promise.allSettled([
        subscribeToTopic({ userId, entityId: user.role, entityType: 'role' }),
        subscribeToTopic({ userId, entityId: 'all',     entityType: 'team' }),
      ]);
    } else {
      // Token rotated — recover all existing subscriptions
      recovery = await resubscribeAllTopics(userId, fcmToken);
    }
  }

  return res.json({
    success: true,
    data: { tokenRegistered: true, recovery },
    message: recovery
      ? `Token registered. ${recovery.restored}/${recovery.total} subscriptions restored.`
      : 'Token registered.',
  });
});

/*
 * UNREGISTER FCM TOKEN
 * DELETE /api/notifications/token
 *
 * Call on logout. Unsubscribes all active topics in Firebase.
 * Subscription docs survive with deviceToken nulled — ready for
 * recovery on next login.
 */
const unregisterFcmToken = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const user = await User.findById(userId).select('fcmToken');
  if (!user) throw new ApiError(404, 'User not found');

  if (user.fcmToken) {
    const activeSubs = await Subscription.find({ userId, isActive: true }).lean();

    if (activeSubs.length) {
      // Unsubscribe all topics — non-blocking, failures are logged
      await Promise.allSettled(
        activeSubs.map((sub) =>
          admin.messaging().unsubscribeFromTopic(user.fcmToken, sub.topic)
        )
      );

      // Null all token snapshots — marks them as needing recovery
      await Subscription.updateMany(
        { userId, isActive: true },
        { $set: { deviceToken: null } }
      );
    }

    user.fcmToken = null;
    await user.save({ validateBeforeSave: false });
  }

  return res.json({
    success: true,
    message: 'Logged out. Notifications paused until next login.',
  });
});

/*
 * MANUAL RECOVERY
 * POST /api/notifications/recover
 *
 * Manually resubscribes all active topics for the current user.
 * Flutter can call this if auto-recovery is suspected to have failed.
 */
const recoverMySubscriptions = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const user = await User.findById(userId).select('fcmToken');
  if (!user) throw new ApiError(404, 'User not found');
  if (!user.fcmToken) {
    throw new ApiError(400, 'No FCM token registered. Open the app on your device first.');
  }

  const result = await resubscribeAllTopics(userId, user.fcmToken);

  return res.json({
    success: true,
    data:    result,
    message: `Recovery complete. ${result.restored}/${result.total} subscriptions restored.`,
  });
});

/*
 * GET MY SUBSCRIPTIONS
 * GET /api/notifications/subscriptions?entityType=group
 *
 * Flutter uses this to check which groups, phases the user is subscribed to.
 * Response grouped by entityType.
 */
const getMySubscriptions = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { entityType } = req.query;

  const filter = { userId, isActive: true };
  if (entityType) filter.entityType = entityType;

  const subs = await Subscription.find(filter)
    .select('entityId entityType topic')
    .lean();

  const grouped = {};
  for (const sub of subs) {
    if (!grouped[sub.entityType]) grouped[sub.entityType] = [];
    grouped[sub.entityType].push({
      entityId: sub.entityId,
      topic:    sub.topic,
    });
  }

  return res.json({
    success: true,
    data: { total: subs.length, grouped },
  });
});

/*
 * GET MY NOTIFICATIONS
 * GET /api/notifications?page=1&limit=20&unreadOnly=true&type=TASK_ASSIGNED
 */
const getMyNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, unreadOnly, type } = req.query;

  const pageNumber = Math.max(parseInt(page, 10), 1);
  const pageLimit  = Math.min(parseInt(limit, 10), 50);
  const skip       = (pageNumber - 1) * pageLimit;

  const filter = { recipientId: userId };
  if (unreadOnly === 'true') filter.isRead = false;
  if (type)                  filter.type   = type;

  const [notifications, total, unreadCount] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientId: userId, isRead: false }),
  ]);

  return res.json({
    success: true,
    data: {
      unreadCount,
      notifications,
      pagination: {
        total,
        page:        pageNumber,
        limit:       pageLimit,
        totalPages:  Math.ceil(total / pageLimit),
        hasNextPage: skip + notifications.length < total,
      },
    },
  });
});

/*
 * MARK ONE AS READ
 * PATCH /api/notifications/:id/read
 */
const markOneAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid notification ID');
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: id, recipientId: req.user._id },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) throw new ApiError(404, 'Notification not found');

  return res.json({ success: true, data: notification });
});

/*
 * MARK ALL AS READ
 * PATCH /api/notifications/read-all
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { recipientId: req.user._id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );

  return res.json({
    success: true,
    data:    { updated: result.modifiedCount },
    message: 'All notifications marked as read',
  });
});

/*
 * DELETE NOTIFICATION
 * DELETE /api/notifications/:id
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid notification ID');
  }

  const notification = await Notification.findOneAndDelete({
    _id:         id,
    recipientId: req.user._id,
  });

  if (!notification) throw new ApiError(404, 'Notification not found');

  return res.json({ success: true, message: 'Notification deleted' });
});

module.exports = {
  registerFcmToken,
  unregisterFcmToken,
  recoverMySubscriptions,
  getMySubscriptions,
  getMyNotifications,
  markOneAsRead,
  markAllAsRead,
  deleteNotification,
};