const { validationResult } = require('express-validator');
const User      = require('./user.model');
const ApiError  = require('../../utils/ApiError');
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

  // Only owner or admin can update
  const isOwner = req.user._id.toString() === req.params.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) throw new ApiError(403, 'Not authorized');

  // Fields owner can change
  const ownerFields = ['name', 'designation', 'colorHex', 'felicitation', 'department', 'app', 'leadField'];
  // Extra fields only admin can change
  const adminFields = ['role'];

  const allowed = isAdmin ? [...ownerFields, ...adminFields] : ownerFields;

  const updates = {};
  allowed.forEach(field => {
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

  // Only owner, hr or admin can update status
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
    // Clear leave fields when back to active or hold
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

  // Notify all connected clients via socket
  req.app.get('io').emit('user:status_changed', {
    userId:      req.params.id,
    status,
    leaveReason: update.leaveReason,
  });

  res.json({ success: true, user });
});

// ── POST /api/users/:id/attendance ────────────
const markAttendance = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  // Only owner, hr or admin can mark attendance
  const isOwner = req.user._id.toString() === req.params.id;
  const isAdmin = ['admin', 'hr'].includes(req.user.role);
  if (!isOwner && !isAdmin) throw new ApiError(403, 'Not authorized');

  const { date, status, note } = req.body;

  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

  // Check if record for this date already exists
  const existingIndex = user.attendance.findIndex(a => {
    const d = new Date(a.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === targetDate.getTime();
  });

  if (existingIndex >= 0) {
    // Update existing record
    user.attendance[existingIndex].status = status;
    user.attendance[existingIndex].note   = note || '';
  } else {
    // Add new record
    user.attendance.push({ date: targetDate, status, note: note || '' });
  }

  await user.save();

  res.json({ success: true, attendance: user.attendance });
});

// ── GET /api/users/:id/attendance ─────────────
const getAttendance = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const user = await User.findById(req.params.id)
    .select('name attendance');
  if (!user) throw new ApiError(404, 'User not found');

  let records = user.attendance;

  // Filter by date range if provided
  const { from, to } = req.query;
  if (from && to) {
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end   = new Date(to);   end.setHours(23, 59, 59, 999);
    records = records.filter(a => a.date >= start && a.date <= end);
  }

  res.json({
    success: true,
    name: user.name,
    attendance: records.sort((a, b) => a.date - b.date),
  });
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
  addGoal,
  toggleGoal,
  deleteGoal,
};