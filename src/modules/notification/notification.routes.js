const express  = require('express');
const router   = express.Router();
const protect  = require('../../middleware/auth.middleware');

const {
  registerFcmToken,
  unregisterFcmToken,
  recoverMySubscriptions,
  getMySubscriptions,
  getMyNotifications,
  markOneAsRead,
  markAllAsRead,
  deleteNotification,
} = require('./notification.controller');

// All notification routes require auth
router.use(protect);

// ── FCM token lifecycle ───────────────────────
// Call PUT on every app launch + after login
// Call DELETE on logout
router.put(   '/token',   registerFcmToken);
router.delete('/token',   unregisterFcmToken);

// ── Recovery (after reinstall / Firebase reset) ──
router.post('/recover', recoverMySubscriptions);

// ── Subscriptions ─────────────────────────────
router.get('/subscriptions', getMySubscriptions);

// ── Inbox ─────────────────────────────────────
router.get('/',              getMyNotifications);
router.patch('/read-all',    markAllAsRead);
router.patch('/:id/read',    markOneAsRead);
router.delete('/:id',        deleteNotification);

module.exports = router;