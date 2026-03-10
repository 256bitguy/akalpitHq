const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const goalSchema = new mongoose.Schema({
  text: { type: String, required: true },
  done: { type: Boolean, default: false },
}, { _id: true });

const attendanceSchema = new mongoose.Schema({
  date:   { type: Date,   required: true },
  status: { type: String, enum: ['present', 'absent', 'leave', 'holiday'], default: 'absent' },
  note:   { type: String, default: '' },
}, { _id: false });

const userSchema = new mongoose.Schema({

  // ── Core ──────────────────────────────────
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },

  // ── Role ──────────────────────────────────
  // admin  → Vivek       (full access)
  // hr     → Vaishnavi   (manage team, push HR updates)
  // lead   → Anurag, Shivam, Khushi, Abhay  (post lead updates, create tasks)
  // member → Mahak, Manya, Pragati
  role: {
    type: String,
    enum: ['admin', 'hr', 'lead', 'member'],
    default: 'member',
  },

  // ── Profile ───────────────────────────────
  designation: { type: String, default: '' },       // "Flutter Dev · CTO"
  department:  {
    type: String,
    enum: ['tech', 'ops', 'creative', 'finance'],
    default: 'ops',
  },
  app: {
    type: String,
    enum: ['akalpit', 'penverse', 'both'],
    default: 'akalpit',
  },
  leadField:     { type: String, default: null },   // "Flutter / Frontend"
  initials:      { type: String, maxlength: 3 },    // "VR", "AC"
  colorHex:      { type: String, default: '#ff6b2b' },
  felicitation:  { type: String, default: '' },     // praise shown on home screen

  // ── Status ────────────────────────────────
  status: {
    type: String,
    enum: ['active', 'leave', 'hold', 'inactive'],
    default: 'active',
  },
  leaveReason: { type: String, default: null },
  leaveFrom:   { type: Date,   default: null },
  leaveTo:     { type: Date,   default: null },

  // ── Notifications ─────────────────────────
  fcmToken:      { type: String, default: null },
  refreshTokens: { type: [String], select: false },

  // ── Content ───────────────────────────────
  goals:      [goalSchema],
  attendance: [attendanceSchema],

}, { timestamps: true });

 

// ── Auto-generate initials before save ────────
// REMOVE this:
// REPLACE with this:
userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }

  if (!this.initials) {
    this.initials = this.name
      .trim()
      .split(' ')
      .map(p => p[0])
      .join('')
      .toUpperCase()
      .slice(0, 3);
  }
});

// ── Compare password ──────────────────────────
userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

// ── Strip sensitive fields for API response ───
userSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.fcmToken;
  return obj;
};

module.exports = mongoose.model('User', userSchema);