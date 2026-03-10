const express = require('express');
const router  = express.Router();

const protect   = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const {
  getAllPhases,
  getPhaseById,
  createPhase,
  updatePhase,
  updatePhaseMembers,
  deletePhase,
} = require('./phase.controller');

// All phase routes require auth
router.use(protect);

// ── Public to all logged in users ─────────────
router.get('/',    getAllPhases);
router.get('/:id', getPhaseById);

// ── Admin and HR only ─────────────────────────
router.post('/',                authorize('admin', 'hr'), createPhase);
router.put( '/:id',             authorize('admin', 'hr'), updatePhase);
router.post('/:id/members',     authorize('admin', 'hr'), updatePhaseMembers);

// ── Admin only ────────────────────────────────
router.delete('/:id',           authorize('admin'),       deletePhase);

module.exports = router;