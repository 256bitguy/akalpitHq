const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema({
  status:    { type: String, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  changedAt: { type: Date, default: Date.now },
  note:      { type: String, default: '' },
}, { _id: false });

const taskSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    priority: {
      type:    String,
      enum:    ['high', 'med', 'low'],
      default: 'med',
    },

    status: {
      type:    String,
      enum:    ['pending', 'inprogress', 'done', 'blocked'],
      default: 'pending',
    },

    // ── Relationships ─────────────────────────
    phase: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Phase',
      required: true,
    },

    createdBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // ── Dates ─────────────────────────────────
    dueDate:     { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // ── Audit trail ───────────────────────────
    statusHistory: [statusHistorySchema],
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────
taskSchema.index({ phase:      1, status: 1 });
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ createdBy:  1, createdAt: -1 });

// ── Auto set completedAt ──────────────────────
taskSchema.pre('save', async function () {
  if (this.isModified('status')) {
    if (this.status === 'done' && !this.completedAt) {
      this.completedAt = new Date();
    }
    if (this.status !== 'done') {
      this.completedAt = null;
    }
  }
});

module.exports = mongoose.model('Task', taskSchema);