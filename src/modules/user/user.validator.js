const { body, query } = require('express-validator');

const updateUserValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name must be at least 2 characters'),

  body('designation')
    .optional()
    .trim(),

  body('department')
    .optional()
    .isIn(['tech', 'ops', 'creative', 'finance'])
    .withMessage('Invalid department'),

  body('app')
    .optional()
    .isIn(['akalpit', 'penverse', 'both'])
    .withMessage('Invalid app value'),

  body('colorHex')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage('colorHex must be a valid hex color e.g. #ff6b2b'),

  body('felicitation')
    .optional()
    .trim(),

  body('leadField')
    .optional()
    .trim(),
];

const updateStatusValidator = [
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['active', 'leave', 'hold'])
    .withMessage('Status must be active, leave or hold'),

  body('leaveReason')
    .if(body('status').equals('leave'))
    .notEmpty()
    .withMessage('Leave reason is required when status is leave'),

  body('leaveFrom')
    .optional()
    .isISO8601()
    .withMessage('leaveFrom must be a valid date'),

  body('leaveTo')
    .optional()
    .isISO8601()
    .withMessage('leaveTo must be a valid date'),
];

const attendanceValidator = [
  body('date')
    .notEmpty()
    .withMessage('Date is required')
    .isISO8601()
    .withMessage('Date must be valid e.g. 2024-03-10'),

  body('status')
    .notEmpty()
    .withMessage('Attendance status is required')
    .isIn(['present', 'absent', 'leave', 'holiday'])
    .withMessage('Status must be present, absent, leave or holiday'),

  body('note')
    .optional()
    .trim(),
];

const goalValidator = [
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Goal text is required')
    .isLength({ max: 200 })
    .withMessage('Goal cannot exceed 200 characters'),
];

const attendanceQueryValidator = [
  query('from')
    .optional()
    .isISO8601()
    .withMessage('from must be a valid date'),

  query('to')
    .optional()
    .isISO8601()
    .withMessage('to must be a valid date'),
];

module.exports = {
  updateUserValidator,
  updateStatusValidator,
  attendanceValidator,
  goalValidator,
  attendanceQueryValidator,
};