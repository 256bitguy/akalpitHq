const Conversation = require('./conversation.model');
const Message      = require('./message.model');
const ApiError     = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const {
  notify,
  notifyMany,
  notifyTopic,
  topicFor,
  subscribeToTopic,
  unsubscribeFromTopic,
} = require('../../utils/notify.js');

// ── GET /api/chat/conversations ───────────────
const getConversations = asyncHandler(async (req, res) => {
  const conversations = await Conversation.find({ members: req.user._id })
    .populate('members',            'name initials colorHex status designation')
    .populate('lastMessage.sender', 'name initials')
    .sort({ 'lastMessage.sentAt': -1 });

  const result = conversations.map((conv) => {
    const obj       = conv.toObject();
    obj.unreadCount = conv.unreadCounts.get(req.user._id.toString()) || 0;
    return obj;
  });

  res.json({ success: true, count: result.length, conversations: result });
});

// ── GET /api/chat/conversations/:id ───────────
const getConversationById = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id:     req.params.id,
    members: req.user._id,
  })
    .populate('members', 'name initials colorHex status designation leaveReason')
    .populate('admin',   'name initials colorHex');

  if (!conversation) throw new ApiError(404, 'Conversation not found');

  res.json({ success: true, conversation });
});

// ── POST /api/chat/dm ─────────────────────────
/*
 * DM: no topic subscription needed.
 * Direct messages use token-based notify() in sendMessage().
 */
const createOrGetDM = asyncHandler(async (req, res) => {
  const { targetUserId } = req.body;

  if (!targetUserId) throw new ApiError(400, 'targetUserId is required');
  if (targetUserId === req.user._id.toString()) {
    throw new ApiError(400, 'Cannot DM yourself');
  }

  let conversation = await Conversation.findOne({
    type:    'dm',
    members: { $all: [req.user._id, targetUserId], $size: 2 },
  }).populate('members', 'name initials colorHex status designation');

  if (!conversation) {
    conversation = await Conversation.create({
      type:    'dm',
      members: [req.user._id, targetUserId],
    });
    await conversation.populate('members', 'name initials colorHex status designation');
  }

  res.json({ success: true, conversation });
});

// ── POST /api/chat/group ──────────────────────
/*
 * GROUP CHAT — topic-based
 * On creation:
 *   1. Subscribe ALL members (including creator) to group_{conversationId}
 *   2. Token-based notify to non-creator members (GROUP_ADDED)
 */
const createGroup = asyncHandler(async (req, res) => {
  const { name, emoji, memberIds } = req.body;

  if (!name?.trim())             throw new ApiError(400, 'Group name is required');
  if (!memberIds || memberIds.length < 2) {
    throw new ApiError(400, 'A group needs at least 2 other members');
  }

  const allMembers = [...new Set([req.user._id.toString(), ...memberIds])];

  const conversation = await Conversation.create({
    type:    'group',
    name:    name.trim(),
    emoji:   emoji || '💬',
    admin:   req.user._id,
    members: allMembers,
  });

  await conversation.populate('members', 'name initials colorHex status designation');

  // Socket: notify other members
  const io = req.app.get('io');
  conversation.members.forEach((m) => {
    if (m._id.toString() !== req.user._id.toString()) {
      io.to(m._id.toString()).emit('chat:group_created', { conversation });
    }
  });

  // Subscribe ALL members to the group FCM topic
  await Promise.allSettled(
    allMembers.map((userId) =>
      subscribeToTopic({
        userId,
        entityId:   conversation._id.toString(),
        entityType: 'group',
      })
    )
  );

  // Token-based notify to non-creator members
  const otherIds = memberIds.filter((id) => id !== req.user._id.toString());

  if (otherIds.length) {
    await notifyMany({
      recipientIds: otherIds,
      senderId:     req.user._id,
      type:         'GROUP_ADDED',
      title:        `💬 ${req.user.name} added you to "${name}"`,
      body:         'Tap to open the group chat',
      payload: {
        screen:    'ChatDetail',
        entityId:  conversation._id.toString(),
        actorId:   req.user._id.toString(),
        actorName: req.user.name,
        extra:     { groupName: name },
      },
    });
  }

  res.status(201).json({ success: true, conversation });
});

// ── PUT /api/chat/group/:id ───────────────────
const updateGroup = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id:     req.params.id,
    type:    'group',
    members: req.user._id,
  });

  if (!conversation) throw new ApiError(404, 'Group not found');

  const isGroupAdmin = conversation.admin.toString() === req.user._id.toString();
  const isAppAdmin   = req.user.role === 'admin';
  if (!isGroupAdmin && !isAppAdmin) {
    throw new ApiError(403, 'Only the group admin can update the group');
  }

  if (req.body.name)  conversation.name  = req.body.name.trim();
  if (req.body.emoji) conversation.emoji = req.body.emoji;

  await conversation.save();

  res.json({ success: true, conversation });
});

// ── POST /api/chat/group/:id/members ─────────
/*
 * When adding members: subscribe them to group topic + notify (GROUP_ADDED)
 * When removing members: unsubscribe them from group topic
 */
const updateGroupMembers = asyncHandler(async (req, res) => {
  const { memberIds, action } = req.body;

  if (!memberIds?.length || !['add', 'remove'].includes(action)) {
    throw new ApiError(400, 'memberIds[] and action (add|remove) required');
  }

  const conversation = await Conversation.findOne({
    _id:  req.params.id,
    type: 'group',
  }).populate('members', 'name initials colorHex');

  if (!conversation) throw new ApiError(404, 'Group not found');

  const isGroupAdmin = conversation.admin.toString() === req.user._id.toString();
  const isAppAdmin   = ['admin', 'hr'].includes(req.user.role);
  if (!isGroupAdmin && !isAppAdmin) {
    throw new ApiError(403, 'Only the group admin can manage members');
  }

  if (action === 'add') {
    memberIds.forEach((id) => {
      if (!conversation.members.some((m) => m._id.toString() === id)) {
        conversation.members.push(id);
      }
    });
  } else {
    conversation.members = conversation.members.filter(
      (m) => !memberIds.includes(m._id.toString())
    );
  }

  await conversation.save();
  await conversation.populate('members', 'name initials colorHex status');

  req.app.get('io').to(req.params.id).emit('chat:members_updated', {
    conversationId: req.params.id,
    members:        conversation.members,
    action,
  });

  if (action === 'add') {
    // Subscribe new members to group topic
    await Promise.allSettled(
      memberIds.map((userId) =>
        subscribeToTopic({
          userId,
          entityId:   conversation._id.toString(),
          entityType: 'group',
        })
      )
    );

    // Notify newly added members
    const newIds = memberIds.filter((id) => id !== req.user._id.toString());
    if (newIds.length) {
      await notifyMany({
        recipientIds: newIds,
        senderId:     req.user._id,
        type:         'GROUP_ADDED',
        title:        `💬 ${req.user.name} added you to "${conversation.name}"`,
        body:         'Tap to open the group chat',
        payload: {
          screen:    'ChatDetail',
          entityId:  conversation._id.toString(),
          actorId:   req.user._id.toString(),
          actorName: req.user.name,
          extra:     { groupName: conversation.name },
        },
      });
    }
  } else {
    // Unsubscribe removed members from group topic
    await Promise.allSettled(
      memberIds.map((userId) =>
        unsubscribeFromTopic({
          userId,
          entityId: conversation._id.toString(),
        })
      )
    );
  }

  res.json({ success: true, conversation });
});

// ── GET /api/chat/conversations/:id/messages ──
const getMessages = asyncHandler(async (req, res) => {
  const { page = 1, limit = 40 } = req.query;

  const conversation = await Conversation.findOne({
    _id:     req.params.id,
    members: req.user._id,
  });
  if (!conversation) throw new ApiError(403, 'Not a member of this conversation');

  const messages = await Message.find({ conversation: req.params.id })
    .populate('sender',  'name initials colorHex')
    .populate('replyTo', 'text sender')
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .skip((Number(page) - 1) * Number(limit));

  const ids = messages.map((m) => m._id);
  await Message.updateMany(
    { _id: { $in: ids }, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  );

  conversation.resetUnread(req.user._id);
  await conversation.save();

  const total = await Message.countDocuments({ conversation: req.params.id });

  res.json({
    success:    true,
    messages:   messages.reverse(),
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
    total,
  });
});

// ── POST /api/chat/conversations/:id/messages ─
/*
 * NOTIFICATION: NEW_MESSAGE
 *
 * DM  → token-based notify() to the other member
 * Group → notifyTopic() to group_{conversationId}
 *         (all members subscribed to the topic receive it)
 *         The sender is NOT excluded at FCM level, but Flutter
 *         should suppress the notification if conversationId
 *         matches the currently open chat screen.
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { text, replyTo } = req.body;
  if (!text?.trim()) throw new ApiError(400, 'Message text is required');

  const conversation = await Conversation.findOne({
    _id:     req.params.id,
    members: req.user._id,
  });
  if (!conversation) throw new ApiError(403, 'Not a member of this conversation');

  const message = await Message.create({
    conversation: req.params.id,
    sender:       req.user._id,
    text:         text.trim(),
    replyTo:      replyTo || null,
    readBy:       [req.user._id],
  });

  await message.populate('sender', 'name initials colorHex');

  conversation.lastMessage = {
    text:   text.trim(),
    sender: req.user._id,
    sentAt: new Date(),
  };
  conversation.incrementUnread(req.user._id);
  await conversation.save();

  // Socket broadcast
  req.app.get('io')
    .to(req.params.id)
    .emit('chat:new_message', { message, conversationId: req.params.id });

  // ── FCM push ─────────────────────────────────
  if (conversation.type === 'dm') {
    // DM: direct token-based push to the other person only
    // Use m._id if populated (User object), else m directly (ObjectId)
    const otherId = conversation.members.find(
      (m) => (m._id ?? m).toString() !== req.user._id.toString()
    );

    if (otherId) {
      await notify({
        recipientId: otherId,
        senderId:    req.user._id,
        type:        'NEW_MESSAGE',
        title:       req.user.name,
        body:        text.trim().slice(0, 100),
        payload: {
          screen:    'ChatDetail',
          entityId:  conversation._id.toString(),
          actorId:   req.user._id.toString(),
          actorName: req.user.name,
          extra:     { type: 'dm' },
        },
      });
    }
  } else {
    // Group: topic-based broadcast to group_{conversationId}
    // No in-app doc saved (broadcast, not personal)
    await notifyTopic({
      topic:   topicFor({ entityType: 'group', entityId: conversation._id.toString() }),
      type:    'NEW_MESSAGE',
      title:   `${conversation.name}: ${req.user.name}`,
      body:    text.trim().slice(0, 100),
      payload: {
        screen:    'ChatDetail',
        entityId:  conversation._id.toString(),
        actorId:   req.user._id.toString(),
        actorName: req.user.name,
        extra:     { type: 'group', groupName: conversation.name },
      },
    });
  }

  res.status(201).json({ success: true, message });
});

// ── DELETE /api/chat/messages/:messageId ──────
const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.messageId);
  if (!message) throw new ApiError(404, 'Message not found');

  const isSender = message.sender.toString() === req.user._id.toString();
  const isAdmin  = ['admin', 'hr'].includes(req.user.role);
  if (!isSender && !isAdmin) throw new ApiError(403, 'Not authorized');

  await message.softDelete(req.user._id);

  req.app.get('io')
    .to(message.conversation.toString())
    .emit('chat:message_deleted', {
      messageId:      message._id,
      conversationId: message.conversation,
    });

  res.json({ success: true, message: 'Message deleted' });
});

// ── DELETE /api/chat/conversations/:id ────────
/*
 * When user leaves a group → unsubscribe from group topic
 */
const leaveConversation = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id:     req.params.id,
    members: req.user._id,
  });
  if (!conversation) throw new ApiError(404, 'Conversation not found');

  if (conversation.type === 'dm') {
    return res.json({ success: true, message: 'DM archived' });
  }

  // Unsubscribe from group FCM topic
  await unsubscribeFromTopic({
    userId:   req.user._id,
    entityId: conversation._id.toString(),
  });

  conversation.members = conversation.members.filter(
    (m) => m.toString() !== req.user._id.toString()
  );

  if (conversation.members.length === 0) {
    await conversation.deleteOne();
    return res.json({ success: true, message: 'Group deleted — no members left' });
  }

  if (conversation.admin.toString() === req.user._id.toString()) {
    conversation.admin = conversation.members[0];
  }

  await conversation.save();
  res.json({ success: true, message: 'Left group successfully' });
});

module.exports = {
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
};