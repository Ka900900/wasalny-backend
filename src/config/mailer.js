/**
 * Mailer configuration — إرسال البريد الإلكتروني (SMTP).
 *
 * يُفعَّل فقط عند تعيين متغيرات SMTP في البيئة:
 *   SMTP_HOST
 *   SMTP_PORT
 *   SMTP_USER
 *   SMTP_PASS
 *   EMAIL_FROM        (المرسل — e.g. "Waslny <no-reply@wasalny.app>")
 *
 * إن لم تكن مكوّنة نعمل بوضع «غير مُفعّل»: نرجع `{ sent: false }` ولا نكسر
 * التطبيق — مع تسجيل تحذير واحد فقط في السجل (بدون أي أسرار).
 */
const nodemailer = require("nodemailer");

const isConfigured = () =>
  Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS,
  );

let transporter = null;
let warnedNotConfigured = false;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // 465 => SSL مباشر
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

const from = () => process.env.EMAIL_FROM || "Waslny <no-reply@wasalny.app>";

/**
 * يرسل بريداً عبر SMTP.
 * @param {{to: string, subject: string, text: string, html?: string}} opts
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    if (!warnedNotConfigured) {
      warnedNotConfigured = true;
      console.warn(
        "⚠️ Mailer غير مكوّن: اضبط SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM على Railway لإرسال رسائل إعادة تعيين كلمة المرور.",
      );
    }
    return { sent: false, reason: "smtp_not_configured" };
  }

  try {
    await getTransporter().sendMail({
      from: from(),
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });
    return { sent: true };
  } catch (error) {
    // نسجّل الفشل دون كشف أي أسرار (كلمة المرور/الرابط).
    console.error("❌ Mailer send failed:", error.message);
    return { sent: false, reason: "smtp_error" };
  }
}

module.exports = { sendMail, isConfigured };
