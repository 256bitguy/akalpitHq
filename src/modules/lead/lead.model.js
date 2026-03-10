const mongoose = require('mongoose');

const leadUpdateSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────
    title: { type: String, required: true, trim: true },
    body:  { type: String, required: true, trim: true },

    // ── Tag ───────────────────────────────────
    // Short label shown on the card
    // e.g. "📤 Update", "🐛 Bug Fix", "✅ Done", "🚧 Blocked"
    tag: { type: String, default: '📤 Update' },

    // ── Who posted it ─────────────────────────
    lead: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    // ── Which field / domain ──────────────────
    // Pulled from user.leadField e.g. "Flutter / Frontend"
    field: { type: String, default: '' },

    // ── Reactions ─────────────────────────────
    // Other leads and admins can react with an emoji
    reactions: [
      {
        user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        emoji: { type: String },
      },
    ],
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────
leadUpdateSchema.index({ lead:      1, createdAt: -1 });
leadUpdateSchema.index({ createdAt: -1 });

module.exports = mongoose.model('LeadUpdate', leadUpdateSchema);