/**
 * ─────────────────────────────────────────────────────────────
 * سكربت تحقق من سياسة العمولة / الإلغاء / غرامة التأخير (2026-08-05)
 * ─────────────────────────────────────────────────────────────
 * يستدعي دوال الخدمة الحقيقية مباشرة (بدون HTTP) للتأكد من المنطق:
 *   1) قبول → خصم عمولة (on_accept)
 *   2) إلغاء كابتن → لا استرداد
 *   3) إلغاء راكب بعد القبول → استرداد مؤجل بعد ساعة (idempotent)
 *   4) وصول + انتهاء عداد → غرامة للكابتن (idempotent)
 *   5) إكمال رحلة → بدون عمولة مكررة (wallet/cash)
 *   6) إلغاء الراكب قبل القبول (PENDING) → بلا أي حركة محفظة
 *
 * ملاحظة: ينشئ مستخدمين تجريبيين (أرقام فريدة) وينظّفهم في النهاية.
 * التشغيل: node scripts/verify-commission-policy.js
 * ─────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const prisma = require('../src/config/prisma');
const {
  acceptRide,
  cancelRide,
  settleRide,
  markRideArrived,
  processDueCommissionRefunds,
  processDueLateFees,
} = require('../src/services/ride.service');

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✅ PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
}

const stamp = Date.now().toString().slice(-8);
let riderId;
let captainId;
let captain2Id;
let createdRideIds = [];
let createdUserIds = [];

async function makeRide({ paymentMethod = 'cash', price = 100, rider = riderId } = {}) {
  const ride = await prisma.rideRequest.create({
    data: {
      riderId: rider,
      pickupPoint: 'Test pickup',
      pickupAddress: 'Test pickup address',
      dropoffPoint: 'Test dropoff',
      destinationAddress: 'Test destination',
      originLat: 30.0444,
      originLng: 31.2357,
      destLat: 30.0582,
      destLng: 31.3224,
      price,
      distance: 8.48,
      durationMinutes: 21,
      pricePerKm: 7,
      commission: toNum((price * 0.1).toFixed(2)),
      commissionRate: 0.1,
      driverEarning: toNum((price * 0.9).toFixed(2)),
      paymentMethod,
      status: 'PENDING',
    },
  });
  createdRideIds.push(ride.id);
  return ride;
}

async function walletOf(userId) {
  const w = await prisma.wallet.findUnique({ where: { userId } });
  return w ? toNum(w.balance) : null;
}

async function txnsForRide(rideId) {
  return prisma.walletTransaction.findMany({ where: { rideId }, orderBy: { createdAt: 'asc' } });
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  سكربت التحقق — سياسة العمولة/الإلغاء/الغرامة');
  console.log('══════════════════════════════════════════════\n');

  // ── الإعداد: مستخدمان تجريبيان (رقم فريد) ──
  const rider = await prisma.user.create({
    data: {
      phoneNumber: `+2${stamp}0001`,
      firstName: 'Verify',
      lastName: 'Rider',
      role: 'RIDER',
      isVerified: true,
    },
  });
  riderId = rider.id;
  createdUserIds.push(riderId);
  await prisma.wallet.create({
    data: { userId: riderId, balance: 1000, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
  });

  // كابتن (قديم التسجيل لضمان نسبة العمولة الأساسية 10% بشكل محدد)
  const captain = await prisma.user.create({
    data: {
      phoneNumber: `+2${stamp}0002`,
      firstName: 'Verify',
      lastName: 'Captain',
      role: 'CAPTAIN',
      isVerified: true,
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    },
  });
  captainId = captain.id;
  createdUserIds.push(captainId);
  await prisma.wallet.create({
    data: { userId: captainId, balance: 500, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
  });
  await prisma.driverProfile.create({
    data: {
      userId: captainId,
      carModel: 'Test Car',
      carPlateNumber: `V${stamp}`,
      carColor: 'White',
      vehicleType: 'PRIVATE_CAR',
      serviceTier: 'ECO',
      carPhotoUrl: '',
      isAvailable: true,
      currentLat: 30.0444,
      currentLng: 31.2357,
      verificationStatus: 'APPROVED',
    },
  });

  // كابتن 2 لاختبار رفض القبول عند تجاوز حد الدين بعد الخصم
  const captain2 = await prisma.user.create({
    data: {
      phoneNumber: `+2${stamp}0003`,
      firstName: 'Verify',
      lastName: 'Debt',
      role: 'CAPTAIN',
      isVerified: true,
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    },
  });
  captain2Id = captain2.id;
  createdUserIds.push(captain2Id);
  await prisma.wallet.create({
    data: { userId: captain2Id, balance: -295, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
  });
  await prisma.driverProfile.create({
    data: {
      userId: captain2Id,
      carModel: 'Test Car 2',
      carPlateNumber: `V2${stamp}`,
      carColor: 'Black',
      vehicleType: 'PRIVATE_CAR',
      serviceTier: 'ECO',
      carPhotoUrl: '',
      isAvailable: true,
      currentLat: 30.0444,
      currentLng: 31.2357,
      verificationStatus: 'APPROVED',
    },
  });

  console.log('✅ تم تجهيز المستخدمين التجريبيين');
  console.log(`   RIDER=${riderId}`);
  console.log(`   CAPTAIN=${captainId}`);
  console.log(`   CAPTAIN2=${captain2Id}\n`);

  // ═══════════════════════════════════════════════
  // السيناريو 1: قبول → خصم عمولة فوراً
  // ═══════════════════════════════════════════════
  console.log('── السيناريو 1: قبول الكابتن → خصم العمولة (on_accept) ──');
  {
    const ride = await makeRide({ paymentMethod: 'cash', price: 100 });
    const before = await walletOf(captainId); // 500
    const accepted = await acceptRide(captainId, ride.id);
    const after = await walletOf(captainId);
    const commission = toNum(accepted.commission);

    check('الحالة أصبحت ACCEPTED', accepted.status === 'ACCEPTED');
    check('acceptedAt محدد', !!accepted.acceptedAt);
    check('commissionDeductedAtAccept = true', accepted.commissionDeductedAtAccept === true);
    check('خصم العمولة من محفظة الكابتن', Math.abs((before - after) - commission) < 0.001,
      `قبل=${before} بعد=${after} عمولة=${commission}`);

    const txn = await prisma.walletTransaction.findFirst({ where: { rideId: ride.id, type: 'COMMISSION' } });
    check('حركة COMMISSION مسجلة', !!txn);
    check('metadata.phase = on_accept', txn?.metadata?.phase === 'on_accept');
    check('قيمة حركة COMMISSION = العمولة', txn && toNum(txn.amount) === commission);
    check('وصف حركة العمولة: "عمولة قبول الرحلة"', txn?.description === 'عمولة قبول الرحلة');
  }

  // ── 1ب: رفض القبول عند تجاوز حد الدين بعد الخصم ──
  console.log('\n── السيناريو 1ب: رفض القبول عند تجاوز حد الدين بعد الخصم ──');
  {
    const ride = await makeRide({ paymentMethod: 'cash', price: 200 });
    const before = await walletOf(captain2Id); // -295
    let rejected = false;
    try {
      await acceptRide(captain2Id, ride.id);
    } catch (e) {
      rejected = true;
      check('رسالة رفض واضحة', /اشحن|حد الدين|WALLET_DEBT_LIMIT/.test(`${e.code || ''} ${e.message}`), e.message);
    }
    check('رفض القبول عند تجاوز حد الدين', rejected);
    check('المحفظة لم تتغير بعد الرفض', (await walletOf(captain2Id)) === before);
    const st = await prisma.rideRequest.findUnique({ where: { id: ride.id }, select: { status: true } });
    check('الرحلة بقيت PENDING بعد الرفض', st?.status === 'PENDING');
  }

  // ═══════════════════════════════════════════════
  // السيناريو 2: إلغاء من الكابتن → لا استرداد
  // ═══════════════════════════════════════════════
  console.log('\n── السيناريو 2: إلغاء الكابتن بعد القبول → لا استرداد ──');
  {
    const ride = await makeRide({ paymentMethod: 'cash', price: 100 });
    const accepted = await acceptRide(captainId, ride.id);
    const afterAccept = await walletOf(captainId);
    const cancelled = await cancelRide(captainId, ride.id);

    check('الحالة أصبحت CANCELLED', cancelled.status === 'CANCELLED');
    check('cancelledBy = CAPTAIN', cancelled.cancelledBy === 'CAPTAIN');
    check('cancelledAt محدد', !!cancelled.cancelledAt);
    check('لا pendingCommissionRefundAt (لا استرداد مجدول)', cancelled.pendingCommissionRefundAt === null);

    const refundTxn = await prisma.walletTransaction.findFirst({ where: { rideId: ride.id, type: 'COMMISSION_REFUND' } });
    check('لا حركة COMMISSION_REFUND', !refundTxn);

    const nowBal = await walletOf(captainId);
    check('رصيد الكابتن لم يُسترد (ثابت بعد القبول)', Math.abs(nowBal - afterAccept) < 0.001,
      `بعد القبول=${afterAccept} بعد الإلغاء=${nowBal}`);
  }

  // ═══════════════════════════════════════════════
  // السيناريو 3: إلغاء من الراكب بعد القبول → استرداد مؤجل بعد ساعة
  // ═══════════════════════════════════════════════
  console.log('\n── السيناريو 3: إلغاء الراكب بعد القبول → استرداد مؤجل (ساعة) ──');
  {
    const ride = await makeRide({ paymentMethod: 'cash', price: 100 });
    const accepted = await acceptRide(captainId, ride.id);
    const commission = toNum(accepted.commission);
    const afterAccept = await walletOf(captainId);

    const cancelled = await cancelRide(riderId, ride.id);
    check('الحالة أصبحت CANCELLED', cancelled.status === 'CANCELLED');
    check('cancelledBy = RIDER', cancelled.cancelledBy === 'RIDER');
    check('pendingCommissionRefundAt مجدول (ليس فورياً)', !!cancelled.pendingCommissionRefundAt);
    const dueMs = new Date(cancelled.pendingCommissionRefundAt).getTime() - Date.now();
    check('مدة التأجيل ≈ 60 دقيقة', dueMs > 50 * 60 * 1000 && dueMs <= 70 * 60 * 1000, `المتبقي=${Math.round(dueMs / 60000)} دقيقة`);
    check('لا COMMISSION_REFUND فوراً', !(await prisma.walletTransaction.findFirst({ where: { rideId: ride.id, type: 'COMMISSION_REFUND' } })));
    check('رصيد الكابتن لم يُسترد فوراً', (await walletOf(captainId)) === afterAccept);

    // محاكاة مرور الساعة: نجعل موعد الاستحقاق في الماضي ونشغّل العامل
    await prisma.rideRequest.update({
      where: { id: ride.id },
      data: { pendingCommissionRefundAt: new Date(Date.now() - 1000) },
    });
    await processDueCommissionRefunds();
    const refundTxn = await prisma.walletTransaction.findFirst({ where: { rideId: ride.id, type: 'COMMISSION_REFUND' } });
    check('حركة COMMISSION_REFUND بعد الساعة', !!refundTxn);
    check('قيمة الاسترداد = العمولة', refundTxn && toNum(refundTxn.amount) === commission);
    check('وصف الاسترداد', refundTxn?.description === 'استرداد عمولة بعد إلغاء الراكب');
    const afterRefund = await walletOf(captainId);
    check('العمولة أُعيدت للكابتن', Math.abs(afterRefund - (afterAccept + commission)) < 0.001,
      `بعد القبول=${afterAccept} بعد الاسترداد=${afterRefund}`);
    const rideAfter = await prisma.rideRequest.findUnique({ where: { id: ride.id }, select: { commissionRefundedAt: true } });
    check('commissionRefundedAt محدد', !!rideAfter?.commissionRefundedAt);

    // منع الاسترداد المزدوج
    await processDueCommissionRefunds();
    const count = await prisma.walletTransaction.count({ where: { rideId: ride.id, type: 'COMMISSION_REFUND' } });
    check('لا استرداد مزدوج (مرة واحدة فقط)', count === 1);
    check('رصيد الكابتن لم يتغير بعد التشغيل الثاني', (await walletOf(captainId)) === afterRefund);
  }

  // ═══════════════════════════════════════════════
  // السيناريو 4: وصول الكابتن + انتهاء عداد الانتظار → غرامة للكابتن
  // ═══════════════════════════════════════════════
  console.log('\n── السيناريو 4: وصول + انتهاء العداد → غرامة تأخير للكابتن ──');
  {
    const ride = await makeRide({ paymentMethod: 'cash', price: 100 });
    await acceptRide(captainId, ride.id);
    const capBefore = await walletOf(captainId);
    const riderBefore = await walletOf(riderId); // 1000

    const arrived = await markRideArrived(captainId, ride.id);
    check('arrivedAt محدد بعد تسجيل الوصول', !!arrived.arrivedAt);

    // محاكاة انتهاء العداد (أجّلنا الوصول 10 دقائق في الماضي) ثم نشغّل العامل
    await prisma.rideRequest.update({
      where: { id: ride.id },
      data: { arrivedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await processDueLateFees();

    const capCredit = await prisma.walletTransaction.findFirst({ where: { rideId: ride.id, type: 'LATE_FEE_CREDIT' } });
    const riderDebit = await prisma.walletTransaction.findFirst({ where: { rideId: ride.id, type: 'LATE_FEE' } });
    check('LATE_FEE_CREDIT للكابتن', !!capCredit);
    check('LATE_FEE للراكب', !!riderDebit);
    check('قيمة الغرامة للكابتن = 10', capCredit && toNum(capCredit.amount) === 10);
    check('قيمة الغرامة من الراكب = 10', riderDebit && toNum(riderDebit.amount) === 10);
    check('metadata.reason = rider_late', capCredit?.metadata?.reason === 'rider_late');
    check('رصيد الكابتن زاد بمقدار الغرامة', (await walletOf(captainId)) === capBefore + 10,
      `قبل=${capBefore} بعد=${await walletOf(captainId)}`);
    check('رصيد الراكب انخفض بمقدار الغرامة', (await walletOf(riderId)) === riderBefore - 10,
      `قبل=${riderBefore} بعد=${await walletOf(riderId)}`);
    const rideAfter = await prisma.rideRequest.findUnique({ where: { id: ride.id }, select: { lateFeeApplied: true, lateFeeAppliedAt: true, lateFeeAmount: true } });
    check('lateFeeApplied = true', rideAfter?.lateFeeApplied === true);
    check('lateFeeAppliedAt محدد', !!rideAfter?.lateFeeAppliedAt);
    check('lateFeeAmount = 10', rideAfter && toNum(rideAfter.lateFeeAmount) === 10);

    // منع التكرار
    await processDueLateFees();
    const capCredits = await prisma.walletTransaction.count({ where: { rideId: ride.id, type: 'LATE_FEE_CREDIT' } });
    check('لا غرامة مكررة', capCredits === 1);
  }

  // ═══════════════════════════════════════════════
  // السيناريو 5: إكمال الرحلة → بدون عمولة مكررة
  // ═══════════════════════════════════════════════
  console.log('\n── السيناريو 5أ: إكمال رحلة (wallet) → بدون عمولة مكررة ──');
  {
    const price = 100;
    const ride = await makeRide({ paymentMethod: 'wallet', price });
    const accepted = await acceptRide(captainId, ride.id);
    const commission = toNum(accepted.commission);
    const capBefore = await walletOf(captainId);
    const riderBefore = await walletOf(riderId);

    // بدء الرحلة (status → STARTED)
    await prisma.rideRequest.update({ where: { id: ride.id }, data: { status: 'STARTED' } });

    const { updatedRide } = await settleRide(null, { rideId: ride.id, driverId: captainId });
    check('الحالة COMPLETED و isPaid', updatedRide.status === 'COMPLETED' && updatedRide.isPaid === true);

    // الراكب دفع السعر كاملاً
    check('خصم price من محفظة الراكب', (await walletOf(riderId)) === riderBefore - price,
      `قبل=${riderBefore} بعد=${await walletOf(riderId)}`);

    // الكابتن استلم السعر الكامل (لأن العمولة اتخصمت عند القبول)
    const capAfter = await walletOf(captainId);
    check('إضافة السعر الكامل للكابتن (بدون خصم عمولة ثانٍ)', Math.abs(capAfter - (capBefore + price)) < 0.001,
      `قبل=${capBefore} بعد=${capAfter}`);
    check('صافي الكابتن = driverEarning', Math.abs((capAfter - capBefore) - (price - commission)) < 0.001,
      `صافي=${capAfter - capBefore} driverEarning=${price - commission}`);

    // العمولة خُصمت مرة واحدة فقط (عند القبول) وليس عند التسوية
    const commissionTxns = await prisma.walletTransaction.findMany({ where: { rideId: ride.id, type: 'COMMISSION' } });
    check('لا توجد حركة COMMISSION عند التسوية (مرة واحدة فقط)', commissionTxns.length === 1);
    check('حركة COMMISSION الوحيدة phase=on_accept', commissionTxns[0]?.metadata?.phase === 'on_accept');

    const earningTxn = await prisma.walletTransaction.findFirst({ where: { rideId: ride.id, type: 'DRIVER_EARNING' } });
    check('حركة DRIVER_EARNING = السعر الكامل', earningTxn && toNum(earningTxn.amount) === price);
  }

  console.log('\n── السيناريو 5ب: إكمال رحلة (cash) → لا خصم عمولة ثانٍ ──');
  {
    const price = 100;
    const ride = await makeRide({ paymentMethod: 'cash', price });
    const accepted = await acceptRide(captainId, ride.id);
    const capBefore = await walletOf(captainId);

    await prisma.rideRequest.update({ where: { id: ride.id }, data: { status: 'STARTED' } });
    const { updatedRide } = await settleRide(null, { rideId: ride.id, driverId: captainId });
    check('الحالة COMPLETED و isPaid', updatedRide.status === 'COMPLETED' && updatedRide.isPaid === true);
    check('رصيد الكابتن لم يتغير عند التسوية (لا خصم ثانٍ)', (await walletOf(captainId)) === capBefore,
      `قبل=${capBefore} بعد=${await walletOf(captainId)}`);

    const commissionTxns = await prisma.walletTransaction.findMany({ where: { rideId: ride.id, type: 'COMMISSION' } });
    check('عمولة واحدة فقط (عند القبول)', commissionTxns.length === 1);
    const profile = await prisma.driverProfile.findUnique({ where: { userId: captainId }, select: { totalTrips: true } });
    check('totalTrips زادت', profile && profile.totalTrips > 0);
  }

  // ═══════════════════════════════════════════════
  // السيناريو 6: إلغاء الراكب قبل القبول (PENDING) → بلا حركات محفظة
  // ═══════════════════════════════════════════════
  console.log('\n── السيناريو 6: إلغاء الراكب قبل القبول (PENDING) ──');
  {
    const ride = await makeRide({ paymentMethod: 'cash', price: 100 });
    const capBefore = await walletOf(captainId);
    const riderBefore = await walletOf(riderId);
    const cancelled = await cancelRide(riderId, ride.id);
    check('الحالة CANCELLED', cancelled.status === 'CANCELLED');
    check('cancelledBy = RIDER', cancelled.cancelledBy === 'RIDER');
    check('لا pendingCommissionRefundAt', cancelled.pendingCommissionRefundAt === null);
    const anyTxn = await prisma.walletTransaction.count({ where: { rideId: ride.id } });
    check('لا أي حركة محفظة', anyTxn === 0);
    check('محفظة الكابتن لم تتغير', (await walletOf(captainId)) === capBefore);
    check('محفظة الراكب لم تتغير', (await walletOf(riderId)) === riderBefore);
  }

  // ── التنظيف ───────────────────────────────────
  console.log('\n── التنظيف (حذف بيانات الاختبار) ──');
  try {
    await prisma.walletTransaction.deleteMany({ where: { rideId: { in: createdRideIds } } });
    await prisma.rating.deleteMany({ where: { rideId: { in: createdRideIds } } });
    await prisma.message.deleteMany({ where: { tripId: { in: createdRideIds } } });
    await prisma.rideMessage.deleteMany({ where: { rideId: { in: createdRideIds } } });
    await prisma.supportTicket.deleteMany({ where: { rideId: { in: createdRideIds } } });
    await prisma.rideRequest.deleteMany({ where: { id: { in: createdRideIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    console.log('✅ تم تنظيف بيانات الاختبار');
  } catch (cleanupErr) {
    console.warn('⚠️ فشل التنظيف (غير حرج):', cleanupErr.message);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(`  النتيجة: ${pass} ✅  |  ${fail} ❌`);
  console.log('══════════════════════════════════════════════\n');

  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('💥 خطأ غير متوقع:', err);
  try {
    await prisma.walletTransaction.deleteMany({ where: { rideId: { in: createdRideIds } } });
    await prisma.rideRequest.deleteMany({ where: { id: { in: createdRideIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  } catch (_) { /* تجاهل */ }
  await prisma.$disconnect();
  process.exit(1);
});
