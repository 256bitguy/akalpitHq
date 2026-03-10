const HRUpdate   = require('./hr.model');
const ApiError   = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { sendToTopic } = require('../../services/fcm.service');

// ── GET /api/hr-updates ───────────────────────
const getHRUpdates = asyncHandler(async (req, res) => {
  const updates = await HRUpdate.find()
    .populate('createdBy', 'name initials colorHex designation')
    .populate('phaseRef',  'name num colorHex')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: updates.length, updates });
});

// ── POST /api/hr-updates ──────────────────────
const createHRUpdate = asyncHandler(async (req, res) => {
  const { title, body, phase, phaseRef, milestones } = req.body;

  if (!title) throw new ApiError(400, 'Title is required');
  if (!body)  throw new ApiError(400, 'Body is required');

  const update = await HRUpdate.create({
    title,
    body,
    phase:      phase      || 'General',
    phaseRef:   phaseRef   || null,
    milestones: (milestones || []).map(text => ({ text, done: false })),
    createdBy:  req.user._id,
  });

  await update.populate('createdBy', 'name initials colorHex designation');

  // FCM push to all team members
  sendToTopic('team_all', {
    title: `📢 ${title}`,
    body:  body.slice(0, 100),
    data:  { type: 'hr_update', updateId: update._id.toString() },
  });

  // Notify all via socket
  req.app.get('io').emit('hr:new_update', { update });

  res.status(201).json({ success: true, update });
});

// ── PUT /api/hr-updates/:id/milestones/:msId ──
const toggleMilestone = asyncHandler(async (req, res) => {
  const update = await HRUpdate.findById(req.params.id);
  if (!update) throw new ApiError(404, 'HR update not found');

  const milestone = update.milestones.id(req.params.msId);
  if (!milestone) throw new ApiError(404, 'Milestone not found');

  // Toggle
  milestone.done = !milestone.done;

  if (milestone.done) {
    milestone.doneBy = req.user._id;
    milestone.doneAt = new Date();
  } else {
    milestone.doneBy = null;
    milestone.doneAt = null;
  }

  await update.save();

  res.json({ success: true, milestones: update.milestones });
});

// ── DELETE /api/hr-updates/:id ────────────────
const deleteHRUpdate = asyncHandler(async (req, res) => {
  const update = await HRUpdate.findById(req.params.id);
  if (!update) throw new ApiError(404, 'HR update not found');

  await update.deleteOne();

  res.json({ success: true, message: 'HR update deleted' });
});

module.exports = {
  getHRUpdates,
  createHRUpdate,
  toggleMilestone,
  deleteHRUpdate,
};