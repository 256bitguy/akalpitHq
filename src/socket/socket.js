const jwt          = require('jsonwebtoken');
const User         = require('../modules/user/user.model');
const Conversation = require('../modules/chat/conversation.model');
const Message      = require('../modules/chat/message.model');

// ── Auth: verify JWT on every socket connection ──
const authenticateSocket = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token;

    if (!token) return next(new Error('Authentication required'));

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    const user = await User.findById(decoded.id).select('name initials colorHex status role');
    if (!user) return next(new Error('User not found'));

    // Attach user to socket
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
};

const initSocket = (io) => {

  // ── Apply auth middleware to all connections ──
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`🔌 Connected: ${user.name} (${socket.id})`);

    // ── Join personal room ─────────────────────
    // Used to send notifications directly to this user
    socket.join(user._id.toString());

    // ── Join all existing conversation rooms ───
    // So user gets messages even without manually joining
    try {
      const conversations = await Conversation.find({ members: user._id }).select('_id');
      conversations.forEach(conv => {
        socket.join(conv._id.toString());
      });
      console.log(`  📨 ${user.name} joined ${conversations.length} conversation rooms`);
    } catch (err) {
      console.error('Error joining conversation rooms:', err.message);
    }

    // ── Broadcast online presence ──────────────
    socket.broadcast.emit('presence:online', {
      userId: user._id,
      name:   user.name,
    });

    // ──────────────────────────────────────────
    //  CHAT EVENTS
    // ──────────────────────────────────────────

    // ── Join a specific conversation room ─────
    socket.on('chat:join', async (conversationId, callback) => {
      try {
        // Verify user is a member
        const conv = await Conversation.findOne({
          _id:     conversationId,
          members: user._id,
        });
        if (!conv) {
          return callback?.({ success: false, message: 'Not a member of this conversation' });
        }

        socket.join(conversationId);
        console.log(`  📨 ${user.name} joined room ${conversationId}`);
        callback?.({ success: true });
      } catch (err) {
        callback?.({ success: false, message: err.message });
      }
    });

    // ── Leave a conversation room ──────────────
    socket.on('chat:leave', (conversationId) => {
      socket.leave(conversationId);
      console.log(`  📤 ${user.name} left room ${conversationId}`);
    });

    // ── Send a message ─────────────────────────
    socket.on('chat:send', async (data, callback) => {
      try {
        const { conversationId, text, replyTo } = data;

        if (!text?.trim()) {
          return callback?.({ success: false, message: 'Message text is required' });
        }

        // Verify membership
        const conversation = await Conversation.findOne({
          _id:     conversationId,
          members: user._id,
        });
        if (!conversation) {
          return callback?.({ success: false, message: 'Not a member of this conversation' });
        }

        // Save message to DB
        const message = await Message.create({
          conversation: conversationId,
          sender:       user._id,
          text:         text.trim(),
          replyTo:      replyTo || null,
          readBy:       [user._id],
        });

        await message.populate('sender', 'name initials colorHex');
        if (replyTo) await message.populate('replyTo', 'text sender');

        // Update conversation last message + unread counts
        conversation.lastMessage = {
          text:   text.trim(),
          sender: user._id,
          sentAt: new Date(),
        };
        conversation.incrementUnread(user._id);
        await conversation.save();

        // Broadcast to everyone in the room
        io.to(conversationId).emit('chat:new_message', {
          message,
          conversationId,
        });

        // Return to sender
        callback?.({ success: true, message });

      } catch (err) {
        console.error('chat:send error:', err.message);
        callback?.({ success: false, message: 'Failed to send message' });
      }
    });

    // ── Typing indicator ───────────────────────
    socket.on('chat:typing', (data) => {
      const { conversationId, isTyping } = data;

      // Broadcast to everyone in room EXCEPT sender
      socket.to(conversationId).emit('chat:typing', {
        userId:         user._id,
        name:           user.name,
        conversationId,
        isTyping,
      });
    });

    // ── Read receipts ──────────────────────────
    socket.on('chat:read', async (data, callback) => {
      try {
        const { conversationId } = data;

        // Mark all unread messages as read
        await Message.updateMany(
          {
            conversation: conversationId,
            readBy:       { $ne: user._id },
          },
          { $addToSet: { readBy: user._id } }
        );

        // Reset unread count for this user
        const conversation = await Conversation.findById(conversationId);
        if (conversation) {
          conversation.resetUnread(user._id);
          await conversation.save();
        }

        // Notify others in room that this user has read
        socket.to(conversationId).emit('chat:read_receipt', {
          userId:         user._id,
          name:           user.name,
          conversationId,
        });

        callback?.({ success: true });
      } catch (err) {
        console.error('chat:read error:', err.message);
        callback?.({ success: false, message: err.message });
      }
    });

    // ── Delete a message ───────────────────────
    socket.on('chat:delete', async (data, callback) => {
      try {
        const { messageId } = data;

        const message = await Message.findById(messageId);
        if (!message) {
          return callback?.({ success: false, message: 'Message not found' });
        }

        // Only sender or admin can delete
        const isSender = message.sender.toString() === user._id.toString();
        const isAdmin  = ['admin', 'hr'].includes(user.role);
        if (!isSender && !isAdmin) {
          return callback?.({ success: false, message: 'Not authorized' });
        }

        await message.softDelete(user._id);

        // Notify everyone in the room
        io.to(message.conversation.toString()).emit('chat:message_deleted', {
          messageId:      message._id,
          conversationId: message.conversation,
        });

        callback?.({ success: true });
      } catch (err) {
        console.error('chat:delete error:', err.message);
        callback?.({ success: false, message: err.message });
      }
    });

    // ──────────────────────────────────────────
    //  PRESENCE EVENTS
    // ──────────────────────────────────────────

    // ── Ping — keep presence alive ─────────────
    socket.on('presence:ping', () => {
      socket.broadcast.emit('presence:online', {
        userId: user._id,
        name:   user.name,
      });
    });

    // ──────────────────────────────────────────
    //  DISCONNECT
    // ──────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Disconnected: ${user.name} (${reason})`);

      // Notify everyone this user went offline
      socket.broadcast.emit('presence:offline', {
        userId: user._id,
        name:   user.name,
      });
    });

  });
};

module.exports = initSocket;