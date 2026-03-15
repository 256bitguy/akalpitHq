const { validationResult } = require('express-validator');
const Phase        = require('./phase.model');
const ApiError     = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const {
  notifyTopic,
  notifyMany,
  topicFor,
  subscribeToTopic,
  unsubscribeFromTopic,
} = require('../../utils/notify.js');

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
/*
 * NOTIFICATION: PHASE_CREATED — topic-based + individual
 *
 * Two things happen:
 * 1. All assigned members get a token-based PHASE_CREATED notification
 *    (personal — so each person knows they're on this phase)
 * 2. Each assigned member is subscribed to the phase_{id} topic
 *    so future phase broadcasts reach them automatically
 */
const createPhase = asyncHandler(async (req, res) => {
  const { name, num, description, status, colorHex, targets, memberIds } = req.body;

  if (!name) throw new ApiError(400, 'Phase name is required');

  const count    = await Phase.countDocuments();
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

  req.app.get('io').emit('phase:created', { phase });

  // ── Subscribe all assigned members to the phase topic ────────────
  // and notify them individually
  if (memberIds && memberIds.length) {
    // Subscribe each member to phase_{phaseId} topic
    await Promise.allSettled(
      memberIds.map((userId) =>
        subscribeToTopic({
          userId,
          entityId:   phase._id.toString(),
          entityType: 'phase',
        })
      )
    );

    // Notify each assigned member (skip creator — they know)
    const recipientIds = memberIds.filter(
      (id) => id.toString() !== req.user._id.toString()
    );

    if (recipientIds.length) {
      await notifyMany({
        recipientIds,
        senderId: req.user._id,
        type:     'PHASE_CREATED',
        title:    `📋 New phase: ${name}`,
        body:     `${req.user.name} added you to Phase ${phaseNum} — ${name}`,
        payload: {
          screen:    'PhaseDetail',
          entityId:  phase._id.toString(),
          actorId:   req.user._id.toString(),
          actorName: req.user.name,
          extra:     { phaseNum, phaseName: name },
        },
      });
    }
  }

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

  req.app.get('io').emit('phase:updated', { phase });

  res.json({ success: true, phase });
});

// ── POST /api/phases/:id/members ──────────────
/*
 * NOTIFICATION: PHASE_CREATED (when action === 'add')
 * When new members are added to a phase:
 *  - Subscribe them to the phase_{id} FCM topic
 *  - Notify them individually (token-based)
 * When members are removed:
 *  - Unsubscribe them from the phase_{id} FCM topic
 */
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

  const phase = await Phase.findByIdAndUpdate(req.params.id, update, { new: true })
    .populate('members',   'name initials colorHex designation status')
    .populate('createdBy', 'name initials');

  if (!phase) throw new ApiError(404, 'Phase not found');

  if (action === 'add') {
    // Subscribe new members to phase topic + notify them
    await Promise.allSettled(
      memberIds.map((userId) =>
        subscribeToTopic({
          userId,
          entityId:   phase._id.toString(),
          entityType: 'phase',
        })
      )
    );

    const recipientIds = memberIds.filter(
      (id) => id.toString() !== req.user._id.toString()
    );

    if (recipientIds.length) {
      await notifyMany({
        recipientIds,
        senderId: req.user._id,
        type:     'PHASE_CREATED',
        title:    `📋 Added to Phase ${phase.num} — ${phase.name}`,
        body:     `${req.user.name} added you to ${phase.name}`,
        payload: {
          screen:    'PhaseDetail',
          entityId:  phase._id.toString(),
          actorId:   req.user._id.toString(),
          actorName: req.user.name,
          extra:     { phaseNum: phase.num, phaseName: phase.name },
        },
      });
    }
  } else {
    // Unsubscribe removed members from phase topic
    await Promise.allSettled(
      memberIds.map((userId) =>
        unsubscribeFromTopic({
          userId,
          entityId: phase._id.toString(),
        })
      )
    );
  }

  res.json({ success: true, phase });
});

// ── DELETE /api/phases/:id ────────────────────
const deletePhase = asyncHandler(async (req, res) => {
  const phase = await Phase.findById(req.params.id);
  if (!phase) throw new ApiError(404, 'Phase not found');

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