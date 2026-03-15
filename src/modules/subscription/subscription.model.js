const mongoose = require('mongoose');

/*
 * SUBSCRIPTION MODEL
 * ──────────────────────────────────────────────────────────────────
 * Source of truth for every FCM topic subscription.
 * Firebase holds NO persistent state — this collection does.
 * On reinstall / token rotation → query this + resubscribe all.
 *
 * TOPIC NAMING (never deviate — must match Flutter side)
 * ────────────────────────────────────────────────────────
 *  group_{conversationId}   → group chat members
 *  role_admin               → all admins
 *  role_hr                  → all HR users
 *  role_lead                → all leads
 *  team_all                 → entire team (all roles)
 *  phase_{phaseId}          → roadmap phase members
 *
 * LIFETIME
 * ─────────
 *  Permanent (group, role, team, phase) → expiresAt: null
 *  No temporary subscriptions in this app (no events).
 */

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    // FCM topic string — built by topicFor() in notify.js
    topic: {
      type:     String,
      required: true,
      trim:     true,
    },

    // What kind of entity this subscription tracks
    entityType: {
      type:     String,
      required: true,
      enum:     ['group', 'role', 'team', 'phase'],
    },

    // The ID of the entity (conversationId, phaseId)
    // For role/team subscriptions this is the role string (e.g. "admin")
    entityId: {
      type:     String,
      required: true,
    },

    // Snapshot of user FCM token at subscription time.
    // Nulled on logout. Repopulated on next registerFcmToken call.
    deviceToken: {
      type:    String,
      default: null,
    },

    // false = user has left / been removed from the entity
    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────

// One subscription per user per entity
SubscriptionSchema.index({ userId: 1, entityId: 1 }, { unique: true });

// Recovery query: all active subs for a user when token changes
SubscriptionSchema.index({ userId: 1, isActive: 1 });

// Admin: who is subscribed to an entity (e.g. who is in a group)
SubscriptionSchema.index({ entityId: 1, isActive: 1 });

const Subscription = mongoose.model('Subscription', SubscriptionSchema);
module.exports = Subscription;