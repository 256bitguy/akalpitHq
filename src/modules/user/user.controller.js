const { validationResult } = require('express-validator');
const User       = require('./user.model');
const ApiError   = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

// ── GET /api/users ────────────────────────────
const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ status: { $ne: 'inactive' } })
    .select('-password -refreshTokens -fcmToken')
    .sort({ name: 1 });

  res.json({ success: true, count: users.length, users });
});

// ── GET /api/users/:id ────────────────────────
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('-password -refreshTokens -fcmToken');

  if (!user) throw new ApiError(404, 'User not found');

  res.json({ success: true, user });
});

// ── PUT /api/users/:id ────────────────────────
const updateUser = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const isOwner = req.user._id.toString() === req.params.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) throw new ApiError(403, 'Not authorized');

  const ownerFields = ['name', 'designation', 'colorHex', 'felicitation', 'department', 'app', 'leadField'];
  const adminFields = ['role'];

  const allowed = isAdmin ? [...ownerFields, ...adminFields] : ownerFields;

  const updates = {};
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  const user = await User.findByIdAndUpdate(
    req.params.id,
    updates,
    { new: true, runValidators: true }
  ).select('-password -refreshTokens -fcmToken');

  if (!user) throw new ApiError(404, 'User not found');

  res.json({ success: true, user });
});

// ── PUT /api/users/:id/status ─────────────────
const updateStatus = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const isOwner = req.user._id.toString() === req.params.id;
  const isAdmin = ['admin', 'hr'].includes(req.user.role);
  if (!isOwner && !isAdmin) throw new ApiError(403, 'Not authorized');

  const { status, leaveReason, leaveFrom, leaveTo } = req.body;

  const update = { status };

  if (status === 'leave') {
    update.leaveReason = leaveReason || null;
    update.leaveFrom   = leaveFrom   || null;
    update.leaveTo     = leaveTo     || null;
  } else {
    update.leaveReason = null;
    update.leaveFrom   = null;
    update.leaveTo     = null;
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true }
  ).select('-password -refreshTokens -fcmToken');

  if (!user) throw new ApiError(404, 'User not found');

  req.app.get('io').emit('user:status_changed', {
    userId:      req.params.id,
    status,
    leaveReason: update.leaveReason,
  });

  res.json({ success: true, user });
});

// ── POST /api/users/:id/attendance ────────────
/*
 * BUG FIX 1: Admin and HR can now mark attendance FOR any user.
 *
 * Previous behaviour: only isOwner was correctly permitted, but the
 * check accidentally allowed any member to mark their OWN attendance
 * for any :id because isOwner compared req.user._id vs req.params.id.
 * A member hitting /users/:otherId/attendance would fail only if
 * they weren't isOwner — which was correct. However the route had
 * no guard against a member marking another member's attendance.
 *
 * Explicit guard now:
 *   - Member: can only mark THEIR OWN attendance (req.params.id === req.user._id)
 *   - Admin / HR: can mark attendance for ANY user
 *
 * BUG FIX 2: markedBy is now stored on each attendance record so
 * admin/HR overrides are auditable.
 */
const markAttendance = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const isOwner     = req.user._id.toString() === req.params.id;
  const isAdminOrHR = ['admin', 'hr'].includes(req.user.role);

  // Members can only mark their own; admin/HR can mark anyone
  if (!isOwner && !isAdminOrHR) {
    throw new ApiError(403, 'Not authorized to mark attendance for another user');
  }

  const { date, status, note } = req.body;

  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

  const existingIndex = user.attendance.findIndex((a) => {
    const d = new Date(a.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === targetDate.getTime();
  });

  const record = {
    date:     targetDate,
    status,
    note:     note || '',
    markedBy: req.user._id,   // audit: who marked it
  };

  if (existingIndex >= 0) {
    user.attendance[existingIndex].status   = status;
    user.attendance[existingIndex].note     = note || '';
    user.attendance[existingIndex].markedBy = req.user._id;
  } else {
    user.attendance.push(record);
  }

  await user.save();

  res.json({ success: true, attendance: user.attendance });
});

// ── GET /api/users/:id/attendance ─────────────
/*
 * BUG FIX 3: Any user can view their OWN attendance.
 *            Admin and HR can view attendance for ANY user.
 *            Members cannot view OTHER members' attendance.
 *
 * Previous behaviour: no access check — any authenticated user
 * could query any user's full attendance history.
 */
const getAttendance = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const isOwner     = req.user._id.toString() === req.params.id;
  const isAdminOrHR = ['admin', 'hr'].includes(req.user.role);

  if (!isOwner && !isAdminOrHR) {
    throw new ApiError(403, 'Not authorized to view attendance for another user');
  }

  const user = await User.findById(req.params.id).select('name attendance');
  if (!user) throw new ApiError(404, 'User not found');

  let records = user.attendance;

  const { from, to } = req.query;
  if (from && to) {
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end   = new Date(to);   end.setHours(23, 59, 59, 999);
    records = records.filter((a) => a.date >= start && a.date <= end);
  }

  res.json({
    success:    true,
    name:       user.name,
    attendance: records.sort((a, b) => a.date - b.date),
  });
});

// ── GET /api/users/attendance/all ─────────────
/*
 * NEW: Admin and HR only — get attendance summary for all users.
 * Supports same ?from=&to= date range filter.
 *
 * Route must be registered BEFORE /:id in the router to avoid
 * "all" being treated as a user ID.
 * Add to user.routes.js:
 *   router.get('/attendance/all', protect, requireRole('admin', 'hr'), getAllAttendance);
 */
const getAllAttendance = asyncHandler(async (req, res) => {
  const isAdminOrHR = ['admin', 'hr'].includes(req.user.role);
  if (!isAdminOrHR) {
    throw new ApiError(403, 'Only admin or HR can view all attendance records');
  }

  const { from, to } = req.query;

  const users = await User.find({ status: { $ne: 'inactive' } })
    .select('name initials colorHex designation department role attendance')
    .sort({ name: 1 });

  const result = users.map((user) => {
    let records = user.attendance;

    if (from && to) {
      const start = new Date(from); start.setHours(0, 0, 0, 0);
      const end   = new Date(to);   end.setHours(23, 59, 59, 999);
      records = records.filter((a) => a.date >= start && a.date <= end);
    }

    // Summary counts
    const summary = { present: 0, absent: 0, leave: 0, holiday: 0 };
    records.forEach((r) => {
      if (summary[r.status] !== undefined) summary[r.status]++;
    });

    return {
      userId:      user._id,
      name:        user.name,
      initials:    user.initials,
      colorHex:    user.colorHex,
      designation: user.designation,
      department:  user.department,
      role:        user.role,
      summary,
      attendance:  records.sort((a, b) => a.date - b.date),
    };
  });

  res.json({ success: true, count: result.length, data: result });
});

// ── POST /api/users/me/goals ──────────────────
const addGoal = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { text } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $push: { goals: { text, done: false } } },
    { new: true }
  ).select('goals');

  res.status(201).json({ success: true, goals: user.goals });
});

// ── PUT /api/users/me/goals/:goalId ───────────
const toggleGoal = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('goals');
  if (!user) throw new ApiError(404, 'User not found');

  const goal = user.goals.id(req.params.goalId);
  if (!goal) throw new ApiError(404, 'Goal not found');

  goal.done = !goal.done;
  await user.save();

  res.json({ success: true, goals: user.goals });
});

// ── DELETE /api/users/me/goals/:goalId ────────
const deleteGoal = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('goals');
  if (!user) throw new ApiError(404, 'User not found');

  const goal = user.goals.id(req.params.goalId);
  if (!goal) throw new ApiError(404, 'Goal not found');

  goal.deleteOne();
  await user.save();

  res.json({ success: true, message: 'Goal removed', goals: user.goals });
});

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  updateStatus,
  markAttendance,
  getAttendance,
  getAllAttendance,
  addGoal,
  toggleGoal,
  deleteGoal,
};