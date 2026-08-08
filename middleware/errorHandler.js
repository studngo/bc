// Centralized error handler. Never leaks stack traces, DB details, or
// secret keys to the client — logs the real error server-side instead.

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'The requested resource was not found.' });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err.message);
  if (err.stack && process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  // Postgres unique-violation
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'This student identification number has already been registered.'
    });
  }

  const statusCode = err.statusCode || 500;
  const message =
    statusCode === 500
      ? 'Something went wrong on our end. Please try again shortly.'
      : err.message;

  res.status(statusCode).json({ error: message });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
