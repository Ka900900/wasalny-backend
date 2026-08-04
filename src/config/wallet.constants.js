const prisma = require('./prisma');

// ─────────────────────────────────────────────────────────────
// ثوابت محفظة الكابتن (مصدر الحقيقة للسياسة المالية)
// ─────────────────────────────────────────────────────────────
// يمكن تعديلها من جدول Config (نفس نمط _getConfig في ride.service)
// وفي غياب السجلات تُستخدم القيم الافتراضية التالية:
//   - الكابتن يكمل الرحلات طالما الرصيد > -300
//   - عند الرصيد <= -300 → إيقاف قبول الرحلات / الأونلاين حتى الشحن
//   - أقل مبلغ شحن: 10 ج
//   - أقصى رصيد في المحفظة: 1500 ج
// ─────────────────────────────────────────────────────────────
const DEFAULT_LIMITS = {
  CAPTAIN_MIN_BALANCE: -300, // حد الدين: يُمنع القبول عند الوصول له
  CAPTAIN_MAX_BALANCE: 1500, // أقصى رصيد مسموح في المحفظة
  CAPTAIN_MIN_TOPUP: 10, // أقل مبلغ للشحن
};

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 دقائق (مطابق لنمط _getConfig)

/**
 * يجلب حدود المحفظة من جدول Config مع التخزين المؤقت 5 دقائق.
 * @returns {Promise<{CAPTAIN_MIN_BALANCE: number, CAPTAIN_MAX_BALANCE: number, CAPTAIN_MIN_TOPUP: number}>}
 */
async function getWalletLimits() {
  const now = Date.now();
  if (_cache === null || now - _cacheAt > CACHE_TTL_MS) {
    const keys = Object.keys(DEFAULT_LIMITS);
    const rows = await prisma.config.findMany({
      where: { key: { in: keys } },
    });
    _cache = { ...DEFAULT_LIMITS };
    for (const row of rows) {
      _cache[row.key] =
        row.valueType === 'NUMBER' ? parseFloat(row.value) : row.value;
    }
    _cacheAt = now;
  }
  return _cache;
}

/**
 * يجلب حداً واحداً من حدود المحفظة مع قيمة افتراضية.
 * @param {string} key
 * @param {number} fallback
 * @returns {Promise<number>}
 */
async function getWalletLimit(key, fallback) {
  const limits = await getWalletLimits();
  return limits[key] !== undefined ? limits[key] : fallback;
}

/**
 * يجلب محفظة المستخدم (قد تكون null إن لم تكن موجودة).
 * @param {string} userId
 * @returns {Promise<import('@prisma/client').Wallet|null>}
 */
async function getCaptainWallet(userId) {
  return prisma.wallet.findUnique({ where: { userId } });
}

/**
 * يتحقق إن كان المستخدم يحق له قبول رحلات / البقاء أونلاين.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function canAcceptRides(userId) {
  const wallet = await getCaptainWallet(userId);
  if (!wallet) return true; // لا محفظة بعد → لا قيود
  const minBalance = await getWalletLimit(
    'CAPTAIN_MIN_BALANCE',
    DEFAULT_LIMITS.CAPTAIN_MIN_BALANCE
  );
  return parseFloat(wallet.balance.toString()) > minBalance;
}

/**
 * يرمي خطأ واضحاً إذا كان الرصيد عند حد الدين أو أقل.
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function assertCanAcceptRides(userId) {
  const wallet = await getCaptainWallet(userId);
  if (!wallet) return;
  const minBalance = await getWalletLimit(
    'CAPTAIN_MIN_BALANCE',
    DEFAULT_LIMITS.CAPTAIN_MIN_BALANCE
  );
  const balance = parseFloat(wallet.balance.toString());
  if (balance <= minBalance) {
    const err = new Error(
      'لا يمكن قبول رحلات. رصيدك عند حد الدين. اشحن المحفظة أولاً'
    );
    err.code = 'WALLET_DEBT_LIMIT';
    throw err;
  }
}

module.exports = {
  DEFAULT_LIMITS,
  getWalletLimits,
  getWalletLimit,
  getCaptainWallet,
  canAcceptRides,
  assertCanAcceptRides,
};
