/*
 * ATTENDANCE SCHEMA PATCH
 * ─────────────────────────────────────────────
 * Add markedBy to attendanceSchema in user.model.js
 *
 * REPLACE this in user.model.js:
 *
 *   const attendanceSchema = new mongoose.Schema({
 *     date:   { type: Date,   required: true },
 *     status: { type: String, enum: ['present', 'absent', 'leave', 'holiday'], default: 'absent' },
 *     note:   { type: String, default: '' },
 *   }, { _id: false });
 *
 * WITH this:
 */

const attendanceSchema = new mongoose.Schema({
  date:   { type: Date,   required: true },
  status: { type: String, enum: ['present', 'absent', 'leave', 'holiday'], default: 'absent' },
  note:   { type: String, default: '' },

  // NEW: audit field — who last marked this record
  // null = self-marked, ObjectId = marked by admin/HR
  markedBy: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
  },
}, { _id: false });

/*
 * NOTE: { _id: false } stays. The markedBy field is just an ObjectId
 * reference — no populate needed for basic attendance views,
 * but you can populate it if you want to show "Marked by Vaishnavi".
 */