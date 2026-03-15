const LeadUpdate   = require('./lead.model');
const ApiError     = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyTopic, topicFor } = require('../../utils/notify.js');

// ── GET /api/lead-updates ─────────────────────
const getLeadUpdates = asyncHandler(async (req, res) => {
  const { leadId } = req.query;

  const filter = {};
  if (leadId) filter.lead = leadId;

  const updates = await LeadUpdate.find(filter)
    .populate('lead',           'name initials colorHex designation leadField')
    .populate('reactions.user', 'name initials colorHex')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: updates.length, updates });
});

// ── POST /api/lead-updates ────────────────────
/*
 * NOTIFICATION: LEAD_UPDATE — topic-based
 * Broadcasts to:
 *   role_admin  → all admins (Vivek)
 *   role_hr     → all HR (Vaishnavi)
 *   role_lead   → all other leads (peer visibility)
 * No in-app docs — topic broadcast only.
 */
const createLeadUpdate = asyncHandler(async (req, res) => {
  const { title, body, tag } = req.body;

  if (!title) throw new ApiError(400, 'Title is required');
  if (!body)  throw new ApiError(400, 'Body is required');

  const update = await LeadUpdate.create({
    title,
    body,
    tag:   tag || '📤 Update',
    lead:  req.user._id,
    field: req.user.leadField || req.user.designation || '',
  });

  await update.populate('lead', 'name initials colorHex designation leadField');

  // Broadcast to admin, HR, and other leads via FCM topics
  const notifyPayload = {
    type:    'LEAD_UPDATE',
    title:   `🗂️ ${req.user.name} — ${title}`,
    body:    body.slice(0, 100),
    payload: {
      screen:    'LeadUpdates',
      entityId:  update._id.toString(),
      actorId:   req.user._id.toString(),
      actorName: req.user.name,
      extra:     { field: req.user.leadField || '' },
    },
  };

  await Promise.allSettled([
    notifyTopic({ topic: topicFor({ entityType: 'role', entityId: 'admin' }), ...notifyPayload }),
    notifyTopic({ topic: topicFor({ entityType: 'role', entityId: 'hr'    }), ...notifyPayload }),
    notifyTopic({ topic: topicFor({ entityType: 'role', entityId: 'lead'  }), ...notifyPayload }),
  ]);

  req.app.get('io').emit('lead:new_update', { update });

  res.status(201).json({ success: true, update });
});

// ── POST /api/lead-updates/:id/reactions ──────
const addReaction = asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) throw new ApiError(400, 'Emoji is required');

  const update = await LeadUpdate.findById(req.params.id);
  if (!update) throw new ApiError(404, 'Lead update not found');

  update.reactions = update.reactions.filter(
    (r) => r.user.toString() !== req.user._id.toString()
  );
  update.reactions.push({ user: req.user._id, emoji });
  await update.save();

  await update.populate('reactions.user', 'name initials colorHex');

  res.json({ success: true, reactions: update.reactions });
});

// ── DELETE /api/lead-updates/:id/reactions ────
const removeReaction = asyncHandler(async (req, res) => {
  const update = await LeadUpdate.findById(req.params.id);
  if (!update) throw new ApiError(404, 'Lead update not found');

  update.reactions = update.reactions.filter(
    (r) => r.user.toString() !== req.user._id.toString()
  );
  await update.save();

  res.json({ success: true, reactions: update.reactions });
});

// ── DELETE /api/lead-updates/:id ─────────────
const deleteLeadUpdate = asyncHandler(async (req, res) => {
  const update = await LeadUpdate.findById(req.params.id);
  if (!update) throw new ApiError(404, 'Lead update not found');

  const isOwner = update.lead.toString() === req.user._id.toString();
  const isAdmin = ['admin', 'hr'].includes(req.user.role);
  if (!isOwner && !isAdmin) throw new ApiError(403, 'Not authorized');

  await update.deleteOne();

  res.json({ success: true, message: 'Lead update deleted' });
});

module.exports = {
  getLeadUpdates,
  createLeadUpdate,
  addReaction,
  removeReaction,
  deleteLeadUpdate,
};