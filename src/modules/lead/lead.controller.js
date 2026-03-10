const LeadUpdate = require('./lead.model');
const ApiError   = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { sendToTopic } = require('../../services/fcm.service');

// ── GET /api/lead-updates ─────────────────────
// Admin/HR sees all — leads see all too (read only)
// Filter by ?leadId= to get one lead's updates
const getLeadUpdates = asyncHandler(async (req, res) => {
  const { leadId } = req.query;

  const filter = {};
  if (leadId) filter.lead = leadId;

  const updates = await LeadUpdate.find(filter)
    .populate('lead',          'name initials colorHex designation leadField')
    .populate('reactions.user','name initials colorHex')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: updates.length, updates });
});

// ── POST /api/lead-updates ────────────────────
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

  // FCM push to admin and hr
  sendToTopic('role_admin', {
    title: `🗂️ Lead Update — ${req.user.name}`,
    body:  title,
    data:  { type: 'lead_update', updateId: update._id.toString() },
  });

  // Notify all via socket
  req.app.get('io').emit('lead:new_update', { update });

  res.status(201).json({ success: true, update });
});

// ── POST /api/lead-updates/:id/reactions ──────
const addReaction = asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) throw new ApiError(400, 'Emoji is required');

  const update = await LeadUpdate.findById(req.params.id);
  if (!update) throw new ApiError(404, 'Lead update not found');

  // Remove existing reaction from this user if any
  update.reactions = update.reactions.filter(
    r => r.user.toString() !== req.user._id.toString()
  );

  // Add new reaction
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
    r => r.user.toString() !== req.user._id.toString()
  );
  await update.save();

  res.json({ success: true, reactions: update.reactions });
});

// ── DELETE /api/lead-updates/:id ─────────────
const deleteLeadUpdate = asyncHandler(async (req, res) => {
  const update = await LeadUpdate.findById(req.params.id);
  if (!update) throw new ApiError(404, 'Lead update not found');

  // Only owner or admin can delete
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