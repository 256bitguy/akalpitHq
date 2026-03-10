const express = require('express');
const router  = express.Router();

const protect   = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const {
  getAllTasks,
  getMyTasks,
  getTaskById,
  createTask,
  updateTask,
  updateTaskStatus,
  updateAssignees,
  deleteTask,
} = require('./task.controller');

// All task routes require auth
router.use(protect);

// !! /my must come BEFORE /:id !!
router.get('/my', getMyTasks);
router.get('/',   getAllTasks);
router.get('/:id', getTaskById);

// ── Create ────────────────────────────────────
router.post('/', authorize('admin', 'hr', 'lead'), createTask);

// ── Update ────────────────────────────────────
router.put('/:id',           updateTask);
router.put('/:id/status',    updateTaskStatus);
router.put('/:id/assignees', authorize('admin', 'hr', 'lead'), updateAssignees);

// ── Delete ────────────────────────────────────
router.delete('/:id', deleteTask);

module.exports = router;