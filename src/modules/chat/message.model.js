const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────
    conversation: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Conversation',
      required: true,
    },

    sender: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    text: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },

    // ── Read receipts ─────────────────────────
    // Array of userIds who have read this message
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // ── Reply to ──────────────────────────────
    replyTo: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Message',
      default: null,
    },

    // ── Soft delete ───────────────────────────
    // We never hard delete — reply chains stay intact
    deletedAt: { type: Date,   default: null },
    deletedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, readBy: 1 });

// ── Instance: soft delete ─────────────────────
messageSchema.methods.softDelete = async function (userId) {
  this.text      = '🚫 Message deleted';
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

// ── Virtual: isDeleted ────────────────────────
messageSchema.virtual('isDeleted').get(function () {
  return !!this.deletedAt;
});

module.exports = mongoose.model('Message', messageSchema);