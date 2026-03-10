const { validationResult } = require('express-validator');
const Phase      = require('./phase.model');
const ApiError   = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

// ── GET /api/phases ───────────────────────────
const getAllPhases = asyncHandler(async (req, res) => {
  const phases = await Phase.find()
    .populate('members',   'name initials colorHex designation status')
    .populate('createdBy', 'name initials colorHex')
    .sort({ num: 1 });

  res.json({ success: true, count: phases.length, phases });
});

// ── GET /api/phases/:id ───────────────────────
const getPhaseById = asyncHandler(async (req, res) => {
  const phase = await Phase.findById(req.params.id)
    .populate('members',   'name initials colorHex designation status leaveReason')
    .populate('createdBy', 'name initials colorHex');

  if (!phase) throw new ApiError(404, 'Phase not found');

  res.json({ success: true, phase });
});

// ── POST /api/phases ──────────────────────────
const createPhase = asyncHandler(async (req, res) => {
  const { name, num, description, status, colorHex, targets, memberIds } = req.body;

  if (!name) throw new ApiError(400, 'Phase name is required');

  // Auto generate num if not provided
  const count   = await Phase.countDocuments();
  const phaseNum = num || String(count + 1).padStart(2, '0');

  const phase = await Phase.create({
    num:         phaseNum,
    name,
    description: description || '',
    status:      status      || 'next',
    colorHex:    colorHex    || '#ff6b2b',
    targets:     targets     || [],
    members:     memberIds   || [],
    createdBy:   req.user._id,
  });

  await phase.populate('members',   'name initials colorHex');
  await phase.populate('createdBy', 'name initials');

  // Notify all via socket
  req.app.get('io').emit('phase:created', { phase });

  res.status(201).json({ success: true, phase });
});

// ── PUT /api/phases/:id ───────────────────────
const updatePhase = asyncHandler(async (req, res) => {
  const { name, description, status, colorHex, targets } = req.body;

  const phase = await Phase.findById(req.params.id);
  if (!phase) throw new ApiError(404, 'Phase not found');

  if (name)        phase.name        = name;
  if (description) phase.description = description;
  if (status)      phase.status      = status;
  if (colorHex)    phase.colorHex    = colorHex;
  if (targets)     phase.targets     = targets;

  await phase.save();

  await phase.populate('members',   'name initials colorHex');
  await phase.populate('createdBy', 'name initials');

  // Notify all via socket
  req.app.get('io').emit('phase:updated', { phase });

  res.json({ success: true, phase });
});

// ── POST /api/phases/:id/members ──────────────
const updatePhaseMembers = asyncHandler(async (req, res) => {
  const { memberIds, action } = req.body;

  if (!memberIds || !memberIds.length) {
    throw new ApiError(400, 'memberIds array is required');
  }
  if (!['add', 'remove'].includes(action)) {
    throw new ApiError(400, 'action must be add or remove');
  }

  const update = action === 'add'
    ? { $addToSet: { members: { $each: memberIds } } }
    : { $pullAll: { members: memberIds } };

  const phase = await Phase.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true }
  )
    .populate('members',   'name initials colorHex designation status')
    .populate('createdBy', 'name initials');

  if (!phase) throw new ApiError(404, 'Phase not found');

  res.json({ success: true, phase });
});

// ── DELETE /api/phases/:id ────────────────────
// replace the deletePhase function with this:
const deletePhase = asyncHandler(async (req, res) => {
  const phase = await Phase.findById(req.params.id);
  if (!phase) throw new ApiError(404, 'Phase not found');

  // Prevent delete if tasks exist
  const Task      = require('../task/task.model');
  const taskCount = await Task.countDocuments({ phase: req.params.id });
  if (taskCount > 0) {
    throw new ApiError(400, `Cannot delete phase with ${taskCount} tasks. Move or delete tasks first.`);
  }

  await phase.deleteOne();
  req.app.get('io').emit('phase:deleted', { phaseId: req.params.id });

  res.json({ success: true, message: 'Phase deleted' });
});
module.exports = {
  getAllPhases,
  getPhaseById,
  createPhase,
  updatePhase,
  updatePhaseMembers,
  deletePhase,
};