const { validationResult } = require('express-validator');
const User = require('../user/user.model');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../utils/tokens');

// ── POST /api/auth/register ───────────────────
const register = asyncHandler(async (req, res) => {
  // 1. Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const {
    name, email, password,
    role, designation, department,
    app, colorHex, felicitation, leadField,
  } = req.body;

  // 2. Check duplicate email
  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'Email already registered');

  // 3. Create user
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

  // 4. Generate tokens
  const accessToken  = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  // 5. Save refresh token
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

  // 1. Find user + select password
  const user = await User.findOne({ email }).select('+password +refreshTokens');
  if (!user) throw new ApiError(401, 'Invalid email or password');

  // 2. Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ApiError(401, 'Invalid email or password');

  // 3. Check if account is active
  if (user.status === 'inactive') {
    throw new ApiError(403, 'Account deactivated. Contact admin.');
  }

  // 4. Generate tokens
  const accessToken  = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  // 5. Allow up to 5 devices — store new refresh token
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

  // 1. Verify the token
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  // 2. Find user + check token is stored
  const user = await User.findById(decoded.id).select('+refreshTokens');
  if (!user || !user.refreshTokens.includes(refreshToken)) {
    throw new ApiError(401, 'Refresh token revoked');
  }

  // 3. Rotate — replace old with new
  const newAccessToken  = generateAccessToken(user._id);
  const newRefreshToken = generateRefreshToken(user._id);

  user.refreshTokens = user.refreshTokens
    .filter(t => t !== refreshToken)
    .concat(newRefreshToken);
  await user.save({ validateBeforeSave: false });

  res.json({
    success: true,
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
  });
});

// ── POST /api/auth/logout ─────────────────────
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const user = await User.findById(req.user._id).select('+refreshTokens');
  if (user && refreshToken) {
    user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
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
const updateFCMToken = asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) throw new ApiError(400, 'fcmToken is required');

  await User.findByIdAndUpdate(req.user._id, { fcmToken });

  res.json({ success: true, message: 'FCM token updated' });
});

module.exports = { register, login, refresh, logout, getMe, updateFCMToken };