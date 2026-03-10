const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    // ── Type ──────────────────────────────────
    type: {
      type:     String,
      enum:     ['dm', 'group'],
      required: true,
    },

    // ── Group only fields ─────────────────────
    name:  { type: String, default: '' },
    emoji: { type: String, default: '💬' },
    admin: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    // ── Members ───────────────────────────────
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // ── Last message snapshot ─────────────────
    // Shown in conversation list without fetching messages
    lastMessage: {
      text:   { type: String, default: '' },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      sentAt: { type: Date, default: null },
    },

    // ── Per user unread counts ─────────────────
    // { "userId": 3, "userId2": 0 }
    unreadCounts: {
      type:    Map,
      of:      Number,
      default: {},
    },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────
conversationSchema.index({ members: 1 });
conversationSchema.index({ 'lastMessage.sentAt': -1 });

// ── Instance: increment unread for all except sender ──
conversationSchema.methods.incrementUnread = function (senderId) {
  this.members.forEach(memberId => {
    const key     = memberId.toString();
    const current = this.unreadCounts.get(key) || 0;
    if (key !== senderId.toString()) {
      this.unreadCounts.set(key, current + 1);
    }
  });
};

// ── Instance: reset unread for one user ───────
conversationSchema.methods.resetUnread = function (userId) {
  this.unreadCounts.set(userId.toString(), 0);
};

module.exports = mongoose.model('Conversation', conversationSchema);