const Task       = require('./task.model');
const Phase      = require('../phase/phase.model');
const ApiError   = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notify, notifyMany } = require('../../utils/notify.js');

// ── Helper: sync phase task counts ───────────
const syncPhaseCounts = async (phaseId) => {
  const [taskCount, doneCount] = await Promise.all([
    Task.countDocuments({ phase: phaseId }),
    Task.countDocuments({ phase: phaseId, status: 'done' }),
  ]);
  await Phase.findByIdAndUpdate(phaseId, { taskCount, doneCount });
};

// ── GET /api/tasks ────────────────────────────
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
/*
 * NOTIFICATION: TASK_ASSIGNED
 * When a task is created, notify ALL assignees (except the creator
 * if the creator assigned themselves — skip self-notification).
 */
const createTask = asyncHandler(async (req, res) => {
  const { title, description, priority, status, phaseId, assignedTo, dueDate } = req.body;

  if (!title)   throw new ApiError(400, 'Title is required');
  if (!phaseId) throw new ApiError(400, 'phaseId is required');
  if (!assignedTo || !assignedTo.length) {
    throw new ApiError(400, 'Assign to at least one member');
  }

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
    statusHistory: [{ status: status || 'pending', changedBy: req.user._id, note: 'Task created' }],
  });

  await task.populate('phase',      'name num colorHex');
  await task.populate('createdBy',  'name initials colorHex');
  await task.populate('assignedTo', 'name initials colorHex designation');

  await syncPhaseCounts(phaseId);

  req.app.get('io').emit('task:created', { task });

  // ── Notify all assignees (skip creator — they know) ──────────────
  const recipientIds = assignedTo.filter(
    (id) => id.toString() !== req.user._id.toString()
  );

  if (recipientIds.length) {
    await notifyMany({
      recipientIds,
      senderId: req.user._id,
      type:     'TASK_ASSIGNED',
      title:    'New task assigned to you',
      body:     `${req.user.name} assigned you "${title}"${phase ? ` in ${phase.name}` : ''}`,
      payload: {
        screen:    'TaskDetail',
        entityId:  task._id.toString(),
        actorId:   req.user._id.toString(),
        actorName: req.user.name,
        extra:     { phaseId: phaseId.toString(), phaseName: phase?.name || '' },
      },
    });
  }

  res.status(201).json({ success: true, task });
});

// ── PUT /api/tasks/:id ────────────────────────
/*
 * NOTIFICATION: TASK_ASSIGNED (when new assignees are added)
 * Only newly added assignees get notified, not existing ones.
 */
const updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) throw new ApiError(404, 'Task not found');

  const isCreator = task.createdBy.toString() === req.user._id.toString();
  const isAdmin   = ['admin', 'hr'].includes(req.user.role);
  if (!isCreator && !isAdmin) {
    throw new ApiError(403, 'Only the creator or admin can edit this task');
  }

  const { title, description, priority, dueDate, assignedTo, phaseId } = req.body;

  const oldPhaseId      = task.phase.toString();
  const previousAssignees = task.assignedTo.map((id) => id.toString());

  if (title       !== undefined) task.title       = title;
  if (description !== undefined) task.description = description;
  if (priority    !== undefined) task.priority    = priority;
  if (dueDate     !== undefined) task.dueDate     = dueDate;
  if (assignedTo  !== undefined) task.assignedTo  = assignedTo;
  if (phaseId     !== undefined) task.phase       = phaseId;

  await task.save();

  await syncPhaseCounts(oldPhaseId);
  if (phaseId && phaseId !== oldPhaseId) {
    await syncPhaseCounts(phaseId);
  }

  await task.populate('phase',      'name num colorHex');
  await task.populate('createdBy',  'name initials colorHex');
  await task.populate('assignedTo', 'name initials colorHex designation');

  req.app.get('io').emit('task:updated', { task });

  // Notify newly added assignees only
  if (assignedTo) {
    const newAssignees = assignedTo.filter(
      (id) => !previousAssignees.includes(id.toString()) &&
               id.toString() !== req.user._id.toString()
    );

    if (newAssignees.length) {
      const phase = task.phase;
      await notifyMany({
        recipientIds: newAssignees,
        senderId:     req.user._id,
        type:         'TASK_ASSIGNED',
        title:        'You have been assigned a task',
        body:         `${req.user.name} assigned you "${task.title}"`,
        payload: {
          screen:    'TaskDetail',
          entityId:  task._id.toString(),
          actorId:   req.user._id.toString(),
          actorName: req.user.name,
          extra:     { phaseId: phase?._id?.toString() || '', phaseName: phase?.name || '' },
        },
      });
    }
  }

  res.json({ success: true, task });
});

// ── PUT /api/tasks/:id/status ─────────────────
/*
 * NOTIFICATION: TASK_STATUS_UPDATED
 * Notify the task creator when an assignee changes status.
 * Notify all assignees when the creator / admin changes status.
 * Never notify the person who changed the status (skip self).
 */
const updateTaskStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;

  const validStatuses = ['pending', 'inprogress', 'done', 'blocked'];
  if (!validStatuses.includes(status)) {
    throw new ApiError(400, `Status must be one of: ${validStatuses.join(', ')}`);
  }

  const task = await Task.findById(req.params.id);
  if (!task) throw new ApiError(404, 'Task not found');

  const isAssignee = task.assignedTo.map((id) => id.toString()).includes(req.user._id.toString());
  const isCreator  = task.createdBy.toString() === req.user._id.toString();
  const isAdmin    = ['admin', 'hr'].includes(req.user.role);

  if (!isAssignee && !isCreator && !isAdmin) {
    throw new ApiError(403, 'Not authorized to update this task status');
  }

  task.status = status;
  task.statusHistory.push({ status, changedBy: req.user._id, note: note || '' });

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

  // Build recipient list: creator + all assignees, minus who changed it
  const interestedParties = [
    task.createdBy._id?.toString() || task.createdBy.toString(),
    ...task.assignedTo.map((u) => u._id?.toString() || u.toString()),
  ];

  const recipientIds = [...new Set(interestedParties)].filter(
    (id) => id !== req.user._id.toString()
  );

  const statusLabels = {
    pending:    '🕐 Pending',
    inprogress: '⚙️ In Progress',
    done:       '✅ Done',
    blocked:    '🚫 Blocked',
  };

  if (recipientIds.length) {
    await notifyMany({
      recipientIds,
      senderId: req.user._id,
      type:     'TASK_STATUS_UPDATED',
      title:    `Task status updated`,
      body:     `${req.user.name} marked "${task.title}" as ${statusLabels[status] || status}`,
      payload: {
        screen:    'TaskDetail',
        entityId:  task._id.toString(),
        actorId:   req.user._id.toString(),
        actorName: req.user.name,
        extra:     {
          status,
          phaseId:   task.phase?._id?.toString() || task.phase.toString(),
          phaseName: task.phase?.name || '',
        },
      },
    });
  }

  res.json({ success: true, task });
});

// ── PUT /api/tasks/:id/assignees ──────────────
/*
 * NOTIFICATION: TASK_ASSIGNED (when action === 'add')
 * Notify newly added assignees.
 */
const updateAssignees = asyncHandler(async (req, res) => {
  const { memberIds, action } = req.body;

  if (!memberIds || !memberIds.length) {
    throw new ApiError(400, 'memberIds array is required');
  }
  if (!['add', 'remove'].includes(action)) {
    throw new ApiError(400, 'action must be add or remove');
  }

  // Get existing task to know who is already assigned
  const existingTask = await Task.findById(req.params.id).select('assignedTo title phase');
  if (!existingTask) throw new ApiError(404, 'Task not found');

  const previousAssignees = existingTask.assignedTo.map((id) => id.toString());

  const update = action === 'add'
    ? { $addToSet: { assignedTo: { $each: memberIds } } }
    : { $pullAll: { assignedTo: memberIds } };

  const task = await Task.findByIdAndUpdate(req.params.id, update, { new: true })
    .populate('phase',      'name num colorHex')
    .populate('assignedTo', 'name initials colorHex designation');

  if (!task) throw new ApiError(404, 'Task not found');

  // Notify newly added members
  if (action === 'add') {
    const newAssignees = memberIds.filter(
      (id) => !previousAssignees.includes(id.toString()) &&
               id.toString() !== req.user._id.toString()
    );

    if (newAssignees.length) {
      await notifyMany({
        recipientIds: newAssignees,
        senderId:     req.user._id,
        type:         'TASK_ASSIGNED',
        title:        'You have been assigned a task',
        body:         `${req.user.name} assigned you "${task.title}"`,
        payload: {
          screen:    'TaskDetail',
          entityId:  task._id.toString(),
          actorId:   req.user._id.toString(),
          actorName: req.user.name,
          extra:     {
            phaseId:   task.phase?._id?.toString() || '',
            phaseName: task.phase?.name || '',
          },
        },
      });
    }
  }

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