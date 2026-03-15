require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');

const connectDB = require('./src/config/db');
const errorMiddleware = require('./src/middleware/error.middleware');
const initSocket = require('./src/socket/socket');

const app = express();
const httpServer = http.createServer(app);

// ── Socket.IO ─────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET', 'POST'] }
});
initSocket(io);
app.set('io', io);

// ── Middleware ────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

// ── Health check ──────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Routes (we will add these one by one) ─────
app.use('/api/auth',         require('./src/modules/auth/auth.routes'));
app.use('/api/users',        require('./src/modules/user/user.routes'));
app.use('/api/phases',       require('./src/modules/phase/phase.routes'));
app.use('/api/tasks',        require('./src/modules/task/task.routes'));
app.use('/api/chat',         require('./src/modules/chat/chat.routes'));
app.use('/api/hr-updates',   require('./src/modules/hr/hr.routes'));
app.use('/api/lead-updates', require('./src/modules/lead/lead.routes'));
app.use('/api/notifications', require('./src/modules/notification/notification.routes.js'));

// ── 404 ───────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ── Global Error Handler ──────────────────────
app.use(errorMiddleware);

// ── Start ─────────────────────────────────────
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌿 Mode: ${process.env.NODE_ENV}`);
  });
});