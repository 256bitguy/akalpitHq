console.log(require('./hr.controller'));
const express = require('express');
const router  = express.Router();

const protect   = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const {
  getHRUpdates,
  createHRUpdate,
  toggleMilestone,
  deleteHRUpdate,
} = require('./hr.controller');

// All HR routes require auth
router.use(protect);

// ── Read — all logged in users ────────────────
router.get('/', getHRUpdates);

// ── Write — admin and hr only ─────────────────
router.post('/',                              authorize('admin', 'hr'), createHRUpdate);
router.put( '/:id/milestones/:msId',          authorize('admin', 'hr'), toggleMilestone);
router.delete('/:id',                         authorize('admin', 'hr'), deleteHRUpdate);

module.exports = router;