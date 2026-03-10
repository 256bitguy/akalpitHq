const { body } = require('express-validator');

const registerValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2 })
    .withMessage('Name must be at least 2 characters'),

  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),

  body('role')
    .optional()
    .isIn(['admin', 'hr', 'lead', 'member'])
    .withMessage('Invalid role'),

  body('department')
    .optional()
    .isIn(['tech', 'ops', 'creative', 'finance'])
    .withMessage('Invalid department'),

  body('app')
    .optional()
    .isIn(['akalpit', 'penverse', 'both'])
    .withMessage('Invalid app value'),
];

const loginValidator = [
  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

module.exports = { registerValidator, loginValidator };