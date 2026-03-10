const Task       = require('./task.model');
const Phase      = require('../phase/phase.model');
const ApiError   = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

// ── Helper: sync phase task counts ───────────
const syncPhaseCounts = async (phaseId) => {
  const [taskCount, doneCount] = await Promise.all([
    Task.countDocuments({ phase: phaseId }),
    Task.countDocuments({ phase: phaseId, status: 'done' }),
  ]);
  await Phase.findByIdAndUpdate(phaseId, { taskCount, doneCount });
};

// ── GET /api/tasks ────────────────────────────
// Query params: ?phase=&assignedTo=&status=&priority=&createdBy=
const getAllTasks = asyncHandler(async (req, res) => {
  const { phase, assignedTo, status, priority, createdBy } = req.query;

  const filter = {};
  if (phase)      filter.phase      = phase;
  if (assignedTo) filter.assignedTo = assignedTo;
  if (status)     filter.status     = status;
  if (priority)   filter.priority   = priority;
  if (createdBy)  filter.createdBy  = createdBy;

  const tasks = await Task.find(filter)
    .populate('phase',      'name num colorHex status')
    .populate('createdBy',  'name initials colorHex designation')
    .populate('assignedTo', 'name initials colorHex designation status')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: tasks.length, tasks });
});

// ── GET /api/tasks/my ─────────────────────────
const getMyTasks = asyncHandler(async (req, res) => {
  const { status, priority } = req.query;

  const filter = { assignedTo: req.user._id };
  if (status)   filter.status   = status;
  if (priority) filter.priority = priority;

  const tasks = await Task.find(filter)
    .populate('phase',      'name num colorHex')
    .populate('createdBy',  'name initials colorHex')
    .populate('assignedTo', 'name initials colorHex')
    .sort({ createdAt: -1 });

  // Sort high priority first
  const order = { high: 0, med: 1, low: 2 };
  tasks.sort((a, b) => order[a.priority] - order[b.priority]);

  res.json({ success: true, count: tasks.length, tasks });
});

// ── GET /api/tasks/:id ────────────────────────
const getTaskById = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id)
    .populate('phase',                   'name num colorHex status')
    .populate('createdBy',               'name initials colorHex designation')
    .populate('assignedTo',              'name initials colorHex designation status')
    .populate('statusHistory.changedBy', 'name initials');

  if (!task) throw new ApiError(404, 'Task not found');

  res.json({ success: true, task });
});

// ── POST /api/tasks ───────────────────────────
const createTask = asyncHandler(async (req, res) => {
  const { title, description, priority, status, phaseId, assignedTo, dueDate } = req.body;

  if (!title)      throw new ApiError(400, 'Title is required');
  if (!phaseId)    throw new ApiError(400, 'phaseId is required');
  if (!assignedTo || !assignedTo.length) {
    throw new ApiError(400, 'Assign to at least one member');
  }

  // Check phase exists
  const phase = await Phase.findById(phaseId);
  if (!phase) throw new ApiError(404, 'Phase not found');

  const task = await Task.create({
    title,
    description:   description || '',
    priority:      priority    || 'med',
    status:        status      || 'pending',
    phase:         phaseId,
    createdBy:     req.user._id,
    assignedTo,
    dueDate:       dueDate     || null,
    statusHistory: [{
      status:    status || 'pending',
      changedBy: req.user._id,
      note:      'Task created',
    }],
  });

  await task.populate('phase',      'name num colorHex');
  await task.populate('createdBy',  'name initials colorHex');
  await task.populate('assignedTo', 'name initials colorHex designation');

  // Update phase task counts
  await syncPhaseCounts(phaseId);

  // Notify assignees via socket
  req.app.get('io').emit('task:created', { task });

  res.status(201).json({ success: true, task });
});

// ── PUT /api/tasks/:id ────────────────────────
const updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) throw new ApiError(404, 'Task not found');

  // Only creator or admin can edit
  const isCreator = task.createdBy.toString() === req.user._id.toString();
  const isAdmin   = ['admin', 'hr'].includes(req.user.role);
  if (!isCreator && !isAdmin) {
    throw new ApiError(403, 'Only the creator or admin can edit this task');
  }

  const { title, description, priority, dueDate, assignedTo, phaseId } = req.body;

  const oldPhaseId = task.phase.toString();

  if (title       !== undefined) task.title       = title;
  if (description !== undefined) task.description = description;
  if (priority    !== undefined) task.priority    = priority;
  if (dueDate     !== undefined) task.dueDate     = dueDate;
  if (assignedTo  !== undefined) task.assignedTo  = assignedTo;
  if (phaseId     !== undefined) task.phase       = phaseId;

  await task.save();

  // Sync counts for old phase and new phase if moved
  await syncPhaseCounts(oldPhaseId);
  if (phaseId && phaseId !== oldPhaseId) {
    await syncPhaseCounts(phaseId);
  }

  await task.populate('phase',      'name num colorHex');
  await task.populate('createdBy',  'name initials colorHex');
  await task.populate('assignedTo', 'name initials colorHex designation');

  req.app.get('io').emit('task:updated', { task });

  res.json({ success: true, task });
});

// ── PUT /api/tasks/:id/status ─────────────────
const updateTaskStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;

  const validStatuses = ['pending', 'inprogress', 'done', 'blocked'];
  if (!validStatuses.includes(status)) {
    throw new ApiError(400, `Status must be one of: ${validStatuses.join(', ')}`);
  }

  const task = await Task.findById(req.params.id);
  if (!task) throw new ApiError(404, 'Task not found');

  // Only assignee, creator or admin can update status
  const isAssignee = task.assignedTo.map(id => id.toString()).includes(req.user._id.toString());
  const isCreator  = task.createdBy.toString() === req.user._id.toString();
  const isAdmin    = ['admin', 'hr'].includes(req.user.role);

  if (!isAssignee && !isCreator && !isAdmin) {
    throw new ApiError(403, 'Not authorized to update this task status');
  }

  task.status = status;
  task.statusHistory.push({
    status,
    changedBy: req.user._id,
    note:      note || '',
  });

  await task.save();
  await syncPhaseCounts(task.phase);

  await task.populate('phase',      'name num colorHex');
  await task.populate('createdBy',  'name initials colorHex');
  await task.populate('assignedTo', 'name initials colorHex');

  req.app.get('io').emit('task:status_updated', {
    taskId:    task._id,
    status,
    changedBy: { id: req.user._id, name: req.user.name },
  });

  res.json({ success: true, task });
});

// ── PUT /api/tasks/:id/assignees ──────────────
const updateAssignees = asyncHandler(async (req, res) => {
  const { memberIds, action } = req.body;

  if (!memberIds || !memberIds.length) {
    throw new ApiError(400, 'memberIds array is required');
  }
  if (!['add', 'remove'].includes(action)) {
    throw new ApiError(400, 'action must be add or remove');
  }

  const update = action === 'add'
    ? { $addToSet: { assignedTo: { $each: memberIds } } }
    : { $pullAll: { assignedTo: memberIds } };

  const task = await Task.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true }
  )
    .populate('assignedTo', 'name initials colorHex designation');

  if (!task) throw new ApiError(404, 'Task not found');

  res.json({ success: true, task });
});

// ── DELETE /api/tasks/:id ─────────────────────
const deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) throw new ApiError(404, 'Task not found');

  const isCreator = task.createdBy.toString() === req.user._id.toString();
  const isAdmin   = ['admin', 'hr'].includes(req.user.role);
  if (!isCreator && !isAdmin) {
    throw new ApiError(403, 'Not authorized to delete this task');
  }

  const phaseId = task.phase;
  await task.deleteOne();
  await syncPhaseCounts(phaseId);

  req.app.get('io').emit('task:deleted', { taskId: req.params.id });

  res.json({ success: true, message: 'Task deleted' });
});

module.exports = {
  getAllTasks,
  getMyTasks,
  getTaskById,
  createTask,
  updateTask,
  updateTaskStatus,
  updateAssignees,
  deleteTask,
};