const mongoose = require('mongoose');

/*
 * NOTIFICATION MODEL
 * ──────────────────────────────────────────────────────────────────
 * Stores in-app notification records (bell icon inbox).
 * One document per notification per recipient.
 *
 * TWO DELIVERY LAYERS — same payload, different transport:
 *
 *  FCM push  → device tray when app is background/killed.
 *              Flutter reads data field for deep-link routing.
 *
 *  In-app doc → this model. Flutter reads on bell tap / app open.
 *               Shape is identical to FCM data payload.
 *
 * FLUTTER ROUTING CONTRACT
 * ────────────────────────
 *   final screen   = notification['payload']['screen'];
 *   final entityId = notification['payload']['entityId'];
 *   final extra    = notification['payload']['extra']; // Map<String,String>
 *
 *   context.pushNamed(screen, pathParameters: {'id': entityId}, extra: extra);
 *
 * SCREEN REGISTRY (keep in sync with Flutter GoRouter routes)
 * ────────────────────────────────────────────────────────────
 *  Screen name        entityId field       extra keys
 *  ─────────────────  ─────────────────    ──────────────────
 *  TaskDetail         taskId               phaseId
 *  PhaseDetail        phaseId              —
 *  LeadUpdates        updateId             —
 *  HRUpdates          updateId             —
 *  ChatDetail         conversationId       —
 *  Notifications      —                    — (fallback)
 */

const PayloadSchema = new mongoose.Schema(
  {
    // Flutter GoRouter route name — must match exactly
    screen: {
      type:     String,
      required: true,
      enum: [
        'TaskDetail',
        'PhaseDetail',
        'LeadUpdates',
        'HRUpdates',
        'ChatDetail',
        'Notifications',
      ],
    },

    // Primary ID the screen uses to load its data
    entityId: { type: String, default: '' },

    // Who triggered the action — for avatar in notification row
    actorId:    { type: String, default: '' },
    actorName:  { type: String, default: '' },

    // Flat Map<String, String> for secondary IDs the screen also needs
    extra: {
      type:    Map,
      of:      String,
      default: {},
    },
  },
  { _id: false }
);

const NotificationSchema = new mongoose.Schema(
  {
    // Who receives this notification
    recipientId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    // Who triggered it — null for system notifications
    senderId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    // Drives icon + colour on Flutter side
    type: {
      type:     String,
      required: true,
      enum: [
        // Tasks
        'TASK_ASSIGNED',           // assignee gets this when task is created / reassigned
        'TASK_STATUS_UPDATED',     // assignee + creator notified when status changes
        // Lead updates
        'LEAD_UPDATE',             // admin/hr gets this when a lead posts an update
        // HR updates
        'HR_UPDATE',               // entire team gets this
        // Chat
        'NEW_MESSAGE',             // personal DM — token-based
        'GROUP_ADDED',             // added to a group chat
        // Roadmap
        'PHASE_CREATED',           // all members notified on new phase
        // System
        'SYSTEM',
      ],
    },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    body:  { type: String, default: '',    trim: true, maxlength: 500 },

    payload: {
      type:     PayloadSchema,
      required: true,
    },

    isRead: { type: Boolean, default: false },
    readAt: { type: Date,    default: null  },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────

// Primary inbox: all notifications for a user, newest first
NotificationSchema.index({ recipientId: 1, createdAt: -1 });

// Unread badge count
NotificationSchema.index({ recipientId: 1, isRead: 1 });

// Auto-delete after 60 days
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 24 * 60 * 60 }
);

const NotificationModel = mongoose.model('Notification', NotificationSchema);
module.exports = NotificationModel;