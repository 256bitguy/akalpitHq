const errorMiddleware = (err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`, err.stack);

  let status  = err.statusCode || 500;
  let message = err.message    || 'Internal Server Error';

  if (err.name === 'CastError')       { status = 404; message = 'Resource not found'; }
  if (err.code === 11000)             { status = 409; message = `${Object.keys(err.keyValue)[0]} already exists`; }
  if (err.name === 'ValidationError') { status = 400; message = Object.values(err.errors).map(e => e.message).join(', '); }

  res.status(status).json({ success: false, message });
};

module.exports = errorMiddleware;