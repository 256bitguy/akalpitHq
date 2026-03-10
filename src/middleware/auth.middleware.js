const jwt     = require('jsonwebtoken');
const User    = require('../modules/user/user.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const protect = asyncHandler(async (req, res, next) => {
  // 1. Get token from header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'No token provided');
  }

  const token = authHeader.split(' ')[1];

  // 2. Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Token expired');
    }
    throw new ApiError(401, 'Invalid token');
  }

  // 3. Find user
  const user = await User.findById(decoded.id).select('-password -refreshTokens');
  if (!user) throw new ApiError(401, 'User no longer exists');

  // 4. Check account is active
  if (user.status === 'inactive') {
    throw new ApiError(403, 'Account deactivated');
  }

  // 5. Attach user to request
  req.user = user;
  next();
});

module.exports = protect;