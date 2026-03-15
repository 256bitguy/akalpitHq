const express = require('express');
const router  = express.Router();

const protect      = require('../../middleware/auth.middleware');
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
  getAllAttendance,   // NEW
  addGoal,
  toggleGoal,
  deleteGoal,
} = require('./user.controller');

router.use(protect);

// ── Goals ─────────────────────────────────────
router.post(  '/me/goals',          goalValidator, addGoal);
router.put(   '/me/goals/:goalId',                 toggleGoal);
router.delete('/me/goals/:goalId',                 deleteGoal);

// ── All users ─────────────────────────────────
router.get('/', getAllUsers);

// ── Attendance (all) — must come BEFORE /:id ──
// Admin / HR only: GET /api/users/attendance/all?from=2025-01-01&to=2025-01-31
router.get('/attendance/all', getAllAttendance);

// ── Attendance (per user) ─────────────────────
// Admin/HR can POST/GET for any :id
// Members can POST/GET only for their own :id
router.post('/:id/attendance', attendanceValidator,      markAttendance);
router.get( '/:id/attendance', attendanceQueryValidator, getAttendance);

// ── Status ────────────────────────────────────
router.put('/:id/status', updateStatusValidator, updateStatus);

// ── Profile ───────────────────────────────────
router.put('/:id', updateUserValidator, updateUser);
router.get('/:id', getUserById);

module.exports = router;