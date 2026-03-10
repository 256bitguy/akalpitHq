const express = require('express');
const router  = express.Router();

const protect = require('../../middleware/auth.middleware');
const {
  getConversations,
  getConversationById,
  createOrGetDM,
  createGroup,
  updateGroup,
  updateGroupMembers,
  getMessages,
  sendMessage,
  deleteMessage,
  leaveConversation,
} = require('./chat.controller');

// All chat routes require auth
router.use(protect);

// ── Conversations ─────────────────────────────
router.get( '/conversations',     getConversations);
router.get( '/conversations/:id', getConversationById);
router.post('/dm',                createOrGetDM);
router.post('/group',             createGroup);

// ── Group management ──────────────────────────
router.put( '/group/:id',         updateGroup);
router.post('/group/:id/members', updateGroupMembers);

// ── Messages ──────────────────────────────────
router.get(   '/conversations/:id/messages', getMessages);
router.post(  '/conversations/:id/messages', sendMessage);
router.delete('/messages/:messageId',        deleteMessage);

// ── Leave / archive ───────────────────────────
router.delete('/conversations/:id',          leaveConversation);

module.exports = router;