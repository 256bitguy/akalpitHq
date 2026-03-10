const express = require('express');
const router  = express.Router();

const protect = require('../../middleware/auth.middleware');
const {
  updateUserValidator,
  updateStatusValidator,
  attendanceValidator,
  goalValidator,
  attendanceQueryValidator,
} = require('./user.validator');
const {
  getAllUsers,
  getUserById,
  updateUser,
  updateStatus,
  markAttendance,
  getAttendance,
  addGoal,
  toggleGoal,
  deleteGoal,
} = require('./user.controller');

router.use(protect);

// ── Goals ─────────────────────────────────────
router.post(  '/me/goals',           goalValidator, addGoal);
router.put(   '/me/goals/:goalId',                  toggleGoal);
router.delete('/me/goals/:goalId',                  deleteGoal);

// ── All users ─────────────────────────────────
router.get('/', getAllUsers);

// ── Attendance ────────────────────────────────
router.post('/:id/attendance', attendanceValidator,      markAttendance);
router.get( '/:id/attendance', attendanceQueryValidator, getAttendance);

// ── Status ────────────────────────────────────
router.put('/:id/status', updateStatusValidator, updateStatus);

// ── Profile ───────────────────────────────────
router.put('/:id', updateUserValidator, updateUser);
router.get('/:id', getUserById);

module.exports = router;
 