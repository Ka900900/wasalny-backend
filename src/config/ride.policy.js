const prisma = require('./prisma');

// ─────────────────────────────────────────────────────────────
// إعدادات سياسة غرامة التأخير والاسترداد المؤجل (مصدر الحقيقة)
// ─────────────────────────────────────────────────────────────
// يمكن تعديلها من جدول Config (نفس نمط _getConfig في ride.service
// و wallet.constants) — وفي غياب السجلات تُستخدم القيم الافتراضية:
//   - RIDER_WAIT_MINUTES: 5  (دقائق انتظار الراكب قبل فرض الغرامة)
//   - RIDER_LATE_FEE: 10     (ج.م — غرامة التأخير تضاف للكابتن)
//   - COMMISSION_REFUND_DELAY_MINUTES: 60 (مدة تأجيل استرداد العمولة
//     عند إلغاء الراكب بعد القبول)
// ─────────────────────────────────────────────────────────────
const RIDE_POLICY_DEFAULTS = {
  RIDER_WAIT_MINUTES: 5,
  RIDER_LATE_FEE: 10,
  COMMISSION_REFUND_DELAY_MINUTES: 60,
};

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 دقائق (مطابق لباقي الأنماط)

/**
 * يجلب إعدادات سياسة الرحلة من جدول Config مع التخزين المؤقت 5 دقائق.
 * @returns {Promise<{RIDER_WAIT_MINUTES: number, RIDER_LATE_FEE: number, COMMISSION_REFUND_DELAY_MINUTES: number}>}
 */
async function getRidePolicyConfig() {
  const now = Date.now();
  if (_cache === null || now - _cacheAt > CACHE_TTL_MS) {
    const keys = Object.keys(RIDE_POLICY_DEFAULTS);
    const rows = await prisma.config.findMany({
      where: { key: { in: keys } },
    });
    _cache = { ...RIDE_POLICY_DEFAULTS };
    for (const row of rows) {
      _cache[row.key] =
        row.valueType === 'NUMBER' ? parseFloat(row.value) : row.value;
    }
    _cacheAt = now;
  }
  return _cache;
}

/**
 * يجلب إعداداً واحداً من سياسة الرحلة مع قيمة افتراضية.
 * @param {string} key
 * @param {number} fallback
 * @returns {Promise<number>}
 */
async function getRidePolicyValue(key, fallback) {
  const cfg = await getRidePolicyConfig();
  return cfg[key] !== undefined ? cfg[key] : fallback;
}

/**
 * إبطال الكاش فوراً (يُستدعى بعد تعديل الإعدادات من لوحة التحكم).
 */
function resetRidePolicyCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = {
  RIDE_POLICY_DEFAULTS,
  getRidePolicyConfig,
  getRidePolicyValue,
  resetRidePolicyCache,
};
