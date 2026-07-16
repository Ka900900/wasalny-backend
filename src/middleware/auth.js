/**
 * JWT authentication middleware.
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'wasalny_super_secret_key_change_me';

/**
 * Verify JWT token from Authorization header.
 * Attaches decoded user to req.user.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'لم يتم توفير توكن' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'توكن غير صالح أو منتهي الصلاحية' });
    }
    req.user = user;
    next();
  });
}

/**
 * Require a specific role (DRIVER, RIDER, ADMIN).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'غير مصرح به' });
    }
    // DEBUG: طباعة الدور الحالي لتسهيل تتبع أخطاء 403 في الترمينال
    console.log(`[requireRole] user role = "${req.user.role}" | required = [${roles.join(', ')}]`);
    // مقارنة غير حساسة لحالة الأحرف (case-insensitive)
    const userRole = String(req.user.role).toUpperCase();
    const allowedRoles = roles.map((r) => String(r).toUpperCase());
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: `هذا المسار مخصص لـ ${roles.join(' أو ')} فقط`,
      });
    }
    next();
  };
}

/**
 * Generate a JWT token for a user.
 */
function generateToken(userId, role, expiresIn = '30d') {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn });
}

module.exports = { authenticateToken, requireRole, generateToken };
