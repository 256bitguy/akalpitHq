const { validationResult } = require('express-validator');
const User = require('../user/user.model');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../utils/tokens');
const { subscribeToTopic, unsubscribeFromTopic } = require('../../utils/notify.js');
const Subscription = require('../../modules/subscription/subscription.model.js');

// ── POST /api/auth/register ───────────────────
const register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const {
    name, email, password,
    role, designation, department,
    app, colorHex, felicitation, leadField,
  } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'Email already registered');

  const user = await User.create({
    name, email, password,
    role:         role         || 'member',
    designation:  designation  || '',
    department:   department   || 'ops',
    app:          app          || 'akalpit',
    colorHex:     colorHex     || '#ff6b2b',
    felicitation: felicitation || '',
    leadField:    leadField    || null,
  });

  const accessToken  = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshTokens = [refreshToken];
  await user.save({ validateBeforeSave: false });

  res.status(201).json({
    success: true,
    message: 'Registered successfully',
    accessToken,
    refreshToken,
    user: user.toPublic(),
  });
});

// ── POST /api/auth/login ──────────────────────
const login = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password +refreshTokens');
  if (!user) throw new ApiError(401, 'Invalid email or password');

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ApiError(401, 'Invalid email or password');

  if (user.status === 'inactive') {
    throw new ApiError(403, 'Account deactivated. Contact admin.');
  }

  const accessToken  = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  const tokens = user.refreshTokens || [];
  user.refreshTokens = [...tokens.slice(-4), refreshToken];
  await user.save({ validateBeforeSave: false });

  res.json({
    success: true,
    message: 'Login successful',
    accessToken,
    refreshToken,
    user: user.toPublic(),
  });
});

// ── POST /api/auth/refresh ────────────────────
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError(400, 'Refresh token required');

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const user = await User.findById(decoded.id).select('+refreshTokens');
  if (!user || !user.refreshTokens.includes(refreshToken)) {
    throw new ApiError(401, 'Refresh token revoked');
  }

  const newAccessToken  = generateAccessToken(user._id);
  const newRefreshToken = generateRefreshToken(user._id);

  user.refreshTokens = user.refreshTokens
    .filter((t) => t !== refreshToken)
    .concat(newRefreshToken);
  await user.save({ validateBeforeSave: false });

  res.json({
    success: true,
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
  });
});

// ── POST /api/auth/logout ─────────────────────
/*
 * On logout:
 * 1. Remove refresh token
 * 2. Unsubscribe all active FCM topics in Firebase
 * 3. Null deviceToken snapshots in Subscription docs
 * 4. Clear fcmToken on user
 *
 * Subscription DOCS are kept — they're the recovery registry.
 * On next login + PUT /api/notifications/token, all topics
 * are automatically resubscribed.
 */
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const user = await User.findById(req.user._id).select('+refreshTokens fcmToken');
  if (user) {
    // Remove refresh token
    if (refreshToken) {
      user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
    }

    // Unsubscribe all FCM topics if user has a token
    if (user.fcmToken) {
      const activeSubs = await Subscription.find({ userId: user._id, isActive: true }).lean();

      // Route through unsubscribeFromTopic() so deviceToken snapshots
      // are nulled in the Subscription docs automatically.
      if (activeSubs.length) {
        await Promise.allSettled(
          activeSubs.map((sub) =>
            unsubscribeFromTopic({ userId: user._id, entityId: sub.entityId })
          )
        );
      }

      user.fcmToken = null;
    }

    await user.save({ validateBeforeSave: false });
  }

  res.json({ success: true, message: 'Logged out successfully' });
});

// ── GET /api/auth/me ──────────────────────────
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new ApiError(404, 'User not found');

  res.json({ success: true, user: user.toPublic() });
});

// ── PUT /api/auth/fcm-token ───────────────────
/*
 * Called on every app launch and after login.
 * Detects token change → triggers full topic recovery.
 * On first registration with no existing subs → auto-subscribes
 * user to their role topic + team_all.
 *
 * This is the RECOVERY ENTRY POINT after:
 *   - App reinstall
 *   - FCM token rotation
 *   - Device change
 */
const updateFCMToken = asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) throw new ApiError(400, 'fcmToken is required');

  const user = await User.findById(req.user._id).select('fcmToken role');
  if (!user) throw new ApiError(404, 'User not found');

  // Capture BEFORE overwriting so comparison is against the old value
  const wasTokenNull = !user.fcmToken;
  const isNewToken   = user.fcmToken !== fcmToken;

  user.fcmToken = fcmToken;
  await user.save({ validateBeforeSave: false });

  let recovery = null;

  if (isNewToken || wasTokenNull) {
    const activeSubs = await Subscription.find({ userId: user._id, isActive: true }).lean();

    if (activeSubs.length === 0) {
      // First time ever — bootstrap role + team subscriptions
      await Promise.allSettled([
        subscribeToTopic({ userId: user._id, entityId: user.role, entityType: 'role' }),
        subscribeToTopic({ userId: user._id, entityId: 'all',     entityType: 'team' }),
      ]);
      recovery = { bootstrapped: true, topics: [`role_${user.role}`, 'team_all'] };
    } else {
      // Token rotated — resubscribe via subscribeToTopic() so deviceToken
      // snapshots in Subscription docs are kept in sync automatically.
      const results = await Promise.allSettled(
        activeSubs.map((sub) =>
          subscribeToTopic({ userId: user._id, entityId: sub.entityId, entityType: sub.entityType })
        )
      );

      recovery = {
        restored: results.filter((r) => r.status === 'fulfilled').length,
        failed:   results.filter((r) => r.status === 'rejected').length,
        total:    activeSubs.length,
      };
    }
  }

  res.json({
    success: true,
    message: recovery
      ? recovery.bootstrapped
        ? `Token registered. Subscribed to ${recovery.topics.join(', ')}.`
        : `Token registered. ${recovery.restored}/${recovery.total} subscriptions restored.`
      : 'Token is already up to date.',
    data: { recovery },
  });
});

module.exports = { register, login, refresh, logout, getMe, updateFCMToken };