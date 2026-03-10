const mongoose = require('mongoose');

const phaseSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────
    num:  { type: String, required: true },        // "01", "02"
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    status: {
      type: String,
      enum: ['planning', 'active', 'done', 'next'],
      default: 'next',
    },

    colorHex: { type: String, default: '#ff6b2b' },

    // ── Targets (display only — shown in roadmap) ──
    targets: [{ type: String, trim: true }],

    // ── Members assigned to this phase ────────
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // ── Who created this phase ─────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true,
    },

    // ── Task count cache ───────────────────────
    // Updated automatically when tasks are created/deleted
    taskCount: { type: Number, default: 0 },
    doneCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────
phaseSchema.index({ status: 1 });
phaseSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Phase', phaseSchema);