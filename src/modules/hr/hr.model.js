const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  text:   { type: String, required: true, trim: true },
  done:   { type: Boolean, default: false },
  doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  doneAt: { type: Date, default: null },
}, { _id: true });

const hrUpdateSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────
    title: { type: String, required: true, trim: true },
    body:  { type: String, required: true, trim: true },

    // ── Phase reference ───────────────────────
    // phase is just a display string e.g. "Phase 2 — Closed Beta"
    phase:    { type: String, default: 'General' },
    phaseRef: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Phase',
      default: null,
    },

    // ── Milestones ────────────────────────────
    // Checkable items inside the update
    milestones: [milestoneSchema],

    // ── Who created it ────────────────────────
    createdBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────
hrUpdateSchema.index({ createdAt: -1 });
hrUpdateSchema.index({ createdBy: 1 });

module.exports = mongoose.model('HRUpdate', hrUpdateSchema);