const express = require('express');
const router  = express.Router();

const protect   = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const {
  getLeadUpdates,
  createLeadUpdate,
  addReaction,
  removeReaction,
  deleteLeadUpdate,
} = require('./lead.controller');

// All lead routes require auth
router.use(protect);

// ── Read — all logged in users ────────────────
router.get('/', getLeadUpdates);

// ── Write — lead, admin, hr only ──────────────
router.post('/', authorize('lead', 'admin', 'hr'), createLeadUpdate);

// ── Reactions — any logged in user ────────────
router.post(  '/:id/reactions', addReaction);
router.delete('/:id/reactions', removeReaction);

// ── Delete — owner or admin ───────────────────
router.delete('/:id', deleteLeadUpdate);

module.exports = router;