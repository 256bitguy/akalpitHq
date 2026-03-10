const express = require('express');
const router  = express.Router();

const { registerValidator, loginValidator } = require('./auth.validator');
const { register, login, refresh, logout, getMe, updateFCMToken } = require('./auth.controller');
const protect = require('../../middleware/auth.middleware');

// ── Public ────────────────────────────────────
router.post('/register', registerValidator, register);
router.post('/login',    loginValidator,    login);
router.post('/refresh',                     refresh);

// ── Protected (need valid access token) ───────
router.post('/logout',       protect, logout);
router.get( '/me',           protect, getMe);
router.put( '/fcm-token',    protect, updateFCMToken);

module.exports = router;