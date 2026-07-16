/**
 * Global error handler middleware.
 */
function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);

  if (err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'بيانات مكررة',
        details: err.meta?.target || 'حقل فريد مكرر',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        error: 'السجل غير موجود',
      });
    }
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'توكن غير صالح أو منتهي الصلاحية',
    });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : 'حدث خطأ في السيرفر';

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * 404 handler for unknown routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'المسار غير موجود',
    path: req.originalUrl,
  });
}

module.exports = { errorHandler, notFoundHandler };
