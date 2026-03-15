const admin           = require('../config/firebase');
const User            = require('../modules/user/user.model');
const Subscription    = require('../modules/subscription/subscription.model');
const Notification    = require('../modules/notification/notification.model');

/*
 * ══════════════════════════════════════════════════════════════════
 * notify.js
 * ──────────────────────────────────────────────────────────────────
 * SINGLE entry point for ALL notification sending in the app.
 * Every controller that needs to notify a user calls one of:
 *
 *   notify()              → one recipient, token-based, saves DB doc
 *   notifyMany()          → multiple recipients, loops notify()
 *   notifyTopic()         → FCM topic broadcast, NO DB doc (broadcast)
 *   subscribeToTopic()    → subscribe user to a topic + write registry
 *   unsubscribeFromTopic()→ unsubscribe user from a topic + update registry
 *   topicFor()            → build the canonical FCM topic string
 *
 * FLUTTER ROUTING CONTRACT
 * ────────────────────────
 * FCM RemoteMessage.data and the in-app API response carry the
 * same payload. Flutter reads it the same way regardless of source:
 *
 *   final p = remoteMessage.data;        // FCM background/killed
 *   final p = notification['payload'];   // in-app API
 *
 *   context.pushNamed(
 *     p['screen'],
 *     pathParameters: { 'id': p['entityId'] },
 *     extra: jsonDecode(p['extra']),
 *   );
 *
 * ══════════════════════════════════════════════════════════════════
 */

// ── Topic name builder ────────────────────────────────────────────
/*
 * topicFor({ entityType, entityId })
 * Returns the canonical FCM topic string. Use this everywhere.
 *
 *   topicFor({ entityType: 'group', entityId: conv._id })
 *   → "group_64f3a..."
 *
 *   topicFor({ entityType: 'role',  entityId: 'admin' })
 *   → "role_admin"
 *
 *   topicFor({ entityType: 'team',  entityId: 'all' })
 *   → "team_all"
 *
 *   topicFor({ entityType: 'phase', entityId: phase._id })
 *   → "phase_64f3b..."
 */
function topicFor({ entityType, entityId }) {
  return `${entityType}_${entityId}`;
}

// ── FCM data payload builder ──────────────────────────────────────
// ALL values MUST be strings — FCM rejects non-string data values.
function buildFcmData({ type, screen, entityId, actorId, actorName, extra }) {
  return {
    type:      String(type      ?? ''),
    screen:    String(screen    ?? 'Notifications'),
    entityId:  String(entityId  ?? ''),
    actorId:   String(actorId   ?? ''),
    actorName: String(actorName ?? ''),
    // extra serialised — Flutter JSON.decodes it
    extra: JSON.stringify(
      Object.fromEntries(
        Object.entries(extra ?? {}).map(([k, v]) => [k, String(v)])
      )
    ),
  };
}

// ── Android + APNS config (reused everywhere) ─────────────────────
const androidConfig = {
  priority:     'high',
  notification: {
    sound:       'default',
    clickAction: 'FLUTTER_NOTIFICATION_CLICK',
  },
};
const apnsConfig = {
  payload: { aps: { sound: 'default', badge: 1 } },
};

/*
 * notify()
 * ──────────────────────────────────────────────────────────────────
 * Send FCM push to one specific recipient AND store an in-app doc.
 * Non-blocking — never throws to the caller.
 *
 * REQUIRED ARGS:
 *   recipientId  {ObjectId|string}   who receives it
 *   type         {string}            NotificationModel type enum
 *   title        {string}            shown in notification tray
 *   payload      {object}            { screen, entityId, actorId, actorName, extra }
 *
 * OPTIONAL ARGS:
 *   senderId     {ObjectId|string}   who triggered it (null for system)
 *   body         {string}            notification body text
 *
 * EXAMPLE — task assigned:
 *   await notify({
 *     recipientId: assigneeId,
 *     senderId:    req.user._id,
 *     type:        'TASK_ASSIGNED',
 *     title:       'New task assigned',
 *     body:        `${req.user.name} assigned you "${task.title}"`,
 *     payload: {
 *       screen:    'TaskDetail',
 *       entityId:  task._id.toString(),
 *       actorId:   req.user._id.toString(),
 *       actorName: req.user.name,
 *       extra:     { phaseId: task.phase.toString() },
 *     },
 *   });
 */
async function notify({ recipientId, senderId = null, type, title, body = '', payload }) {
  try {
    if (!recipientId)      { console.error('[notify] recipientId required'); return; }
    if (!type)             { console.error('[notify] type required');         return; }
    if (!payload?.screen)  { console.error('[notify] payload.screen required'); return; }

    const { screen, entityId = '', actorId = '', actorName = '', extra = {} } = payload;

    const fcmData = buildFcmData({ type, screen, entityId, actorId, actorName, extra });

    // ── FCM push — fire-and-forget ────────────
    User.findById(recipientId).select('fcmToken').lean()
      .then((user) => {
        if (!user?.fcmToken) return;
        return admin.messaging().send({
          token:        user.fcmToken,
          notification: { title, body },
          data:         fcmData,
          android:      androidConfig,
          apns:         apnsConfig,
        });
      })
      .catch((err) => console.error('[notify] FCM error:', err.message));

    // ── In-app notification doc ───────────────
    await Notification.create({
      recipientId,
      senderId: senderId ?? null,
      type,
      title,
      body,
      payload: {
        screen,
        entityId:  String(entityId),
        actorId:   String(actorId),
        actorName: String(actorName),
        extra:     Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [k, String(v)])
        ),
      },
    });

  } catch (err) {
    console.error('[notify] Unexpected error:', err.message);
  }
}

/*
 * notifyMany()
 * ──────────────────────────────────────────────────────────────────
 * Send the same notification to multiple specific recipients.
 * Each recipient gets their own DB doc + individual FCM push.
 *
 * EXAMPLE — task assigned to multiple people:
 *   await notifyMany({
 *     recipientIds: task.assignedTo,
 *     senderId:     req.user._id,
 *     type:         'TASK_ASSIGNED',
 *     title:        'New task assigned',
 *     body:         `${req.user.name} assigned you "${task.title}"`,
 *     payload: { ... },
 *   });
 */
async function notifyMany({ recipientIds = [], ...rest }) {
  if (!recipientIds.length) return;
  await Promise.allSettled(
    recipientIds.map((recipientId) => notify({ recipientId, ...rest }))
  );
}

/*
 * notifyTopic()
 * ──────────────────────────────────────────────────────────────────
 * Sends FCM broadcast to an entire topic.
 * Does NOT create individual in-app docs — this is a broadcast.
 * Used for: lead updates → role_admin, HR updates → team_all,
 *           phase created → phase_{id}, group messages → group_{id}
 *
 * EXAMPLE — HR update to all team:
 *   await notifyTopic({
 *     topic:   topicFor({ entityType: 'team', entityId: 'all' }),
 *     type:    'HR_UPDATE',
 *     title:   `📢 ${title}`,
 *     body:    body.slice(0, 100),
 *     payload: {
 *       screen:   'HRUpdates',
 *       entityId: update._id.toString(),
 *       extra:    {},
 *     },
 *   });
 */
async function notifyTopic({ topic, type, title, body = '', payload }) {
  try {
    if (!topic)           { console.error('[notifyTopic] topic required');          return; }
    if (!payload?.screen) { console.error('[notifyTopic] payload.screen required'); return; }

    const { screen, entityId = '', actorId = '', actorName = '', extra = {} } = payload;

    await admin.messaging().send({
      topic,
      notification: { title, body },
      data:         buildFcmData({ type, screen, entityId, actorId, actorName, extra }),
      android:      androidConfig,
      apns:         { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    console.error('[notifyTopic] Error:', err.message);
  }
}

/*
 * subscribeToTopic()
 * ──────────────────────────────────────────────────────────────────
 * Subscribe a user to an FCM topic AND write to Subscription registry.
 * ALWAYS use this instead of admin.messaging() directly — the registry
 * is what enables token-rotation recovery.
 *
 * USAGE — when user joins a group chat:
 *   await subscribeToTopic({
 *     userId,
 *     entityId:   conversation._id.toString(),
 *     entityType: 'group',
 *   });
 *
 * USAGE — on user creation (subscribe to their role + team_all):
 *   await subscribeToTopic({ userId, entityId: user.role, entityType: 'role' });
 *   await subscribeToTopic({ userId, entityId: 'all',     entityType: 'team' });
 */
async function subscribeToTopic({ userId, entityId, entityType }) {
  const user = await User.findById(userId).select('fcmToken').lean();
  if (!user?.fcmToken) return { subscribed: false, reason: 'no_token' };

  const topic = topicFor({ entityType, entityId: String(entityId) });

  // Upsert — safe to call multiple times
  await Subscription.findOneAndUpdate(
    { userId, entityId: String(entityId) },
    {
      $set: {
        userId,
        entityId:    String(entityId),
        entityType,
        topic,
        deviceToken: user.fcmToken,
        isActive:    true,
      },
    },
    { upsert: true, new: true }
  );

  await admin.messaging()
    .subscribeToTopic(user.fcmToken, topic)
    .catch((e) => console.error('[subscribeToTopic] FCM error:', e.message));

  return { subscribed: true, topic };
}

/*
 * unsubscribeFromTopic()
 * ──────────────────────────────────────────────────────────────────
 * Unsubscribe a user from a topic AND mark inactive in registry.
 * Doc is kept for audit — not deleted.
 *
 * USAGE — when user leaves a group:
 *   await unsubscribeFromTopic({ userId, entityId: conversation._id.toString() });
 */
async function unsubscribeFromTopic({ userId, entityId }) {
  const [user, sub] = await Promise.all([
    User.findById(userId).select('fcmToken').lean(),
    Subscription.findOne({ userId, entityId: String(entityId) }).lean(),
  ]);

  if (!sub) return { unsubscribed: false, reason: 'not_subscribed' };

  await Subscription.findOneAndUpdate(
    { userId, entityId: String(entityId) },
    { $set: { isActive: false, deviceToken: null } }
  );

  if (user?.fcmToken) {
    await admin.messaging()
      .unsubscribeFromTopic(user.fcmToken, sub.topic)
      .catch((e) => console.error('[unsubscribeFromTopic] FCM error:', e.message));
  }

  return { unsubscribed: true, topic: sub.topic };
}

module.exports = {
  topicFor,
  notify,
  notifyMany,
  notifyTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
};