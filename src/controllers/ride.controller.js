const { getRideOptions, calculateRideFare, requestRide, cancelRide, rateRide, settleRide } = require('../services/ride.service');
const prisma = require('../config/prisma');
const { emitRideStatus } = require('../config/socket');
const { createKashierSession, queryKashierTransaction } = require('../services/kashier');

async function getRideOptionsHandler(req, res) {
  try {
    const options = await getRideOptions();
    res.json({ options });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب خيارات الرحلات' });
  }
}

async function calculateRideFareHandler(req, res) {
  try {
    const result = await calculateRideFare(req.query);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في حساب السعر' });
  }
}

async function requestRideHandler(req, res, io) {
  try {
    const newRide = await requestRide(req.user.userId, req.body, io);
    res.status(201).json({
      message: 'تم طلب الرحلة بنجاح!',
      ride: {
        id: newRide.id,
        status: newRide.status,
        pickupAddress: newRide.pickupAddress || newRide.pickupPoint,
        destinationAddress: newRide.destinationAddress || newRide.dropoffPoint,
        originLat: newRide.originLat,
        originLng: newRide.originLng,
        destLat: newRide.destLat,
        destLng: newRide.destLng,
        rideType: newRide.rideType,
        price: newRide.price,
        distance: newRide.distance,
        durationMinutes: newRide.durationMinutes,
        pricePerKm: newRide.pricePerKm,
        commission: newRide.commission,
        commissionRate: newRide.commissionRate,
        driverEarning: newRide.driverEarning,
        paymentMethod: newRide.paymentMethod,
        createdAt: newRide.createdAt,
      },
    });
  } catch (error) {
    console.error('Request ride error:', error.message);
    res.status(500).json({ error: 'حدث خطأ أثناء حفظ الرحلة' });
  }
}

async function getCurrentRideHandler(req, res) {
  try {
    const ride = await prisma.rideRequest.findFirst({
      where: {
        OR: [{ riderId: req.user.userId }, { driverId: req.user.userId }],
        status: { in: ['PENDING', 'ACCEPTED', 'STARTED'] },
      },
      include: {
        rider: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        driver: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, driverProfile: true } },
        rideOption: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ride: ride || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الرحلة الحالية' });
  }
}

async function getRideHistoryHandler(req, res) {
  try {
    const rides = await prisma.rideRequest.findMany({
      where: {
        OR: [{ riderId: req.user.userId }, { driverId: req.user.userId }],
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        rider: { select: { id: true, firstName: true, lastName: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
        rating: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ rides });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب تاريخ الرحلات' });
  }
}

async function cancelRideHandler(req, res, io) {
  try {
    const updated = await cancelRide(req.user.userId, req.params.rideId);
    emitRideStatus(io, req.params.rideId, 'CANCELLED', { cancelledBy: req.user.userId });
    res.json({ message: 'تم إلغاء الرحلة', ride: updated });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في إلغاء الرحلة' });
  }
}

async function initiateKashierPaymentHandler(req, res) {
  try {
    const { rideId } = req.body;
    if (!rideId) return res.status(400).json({ error: 'معرف الرحلة مطلوب' });

    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId }, include: { rider: true } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.riderId !== req.user.userId) return res.status(403).json({ error: 'غير مصرح لك بدفع ثمن هذه الرحلة' });
    if (ride.isPaid) return res.status(400).json({ error: 'هذه الرحلة مدفوعة مسبقاً' });

    const session = await createKashierSession(
      rideId,
      ride.price,
      `${ride.rider.firstName} ${ride.rider.lastName}`,
      ride.rider.phoneNumber,
      `دفع تكلفة الرحلة رقم ${rideId}`
    );

    // نعيد للتطبيق البيانات العامة اللازمة فقط:
    // التوقيع مشتق من السر لكنه خاص بهذه العملية وآمن للإرسال، والسر نفسه لا يُرسل أبداً.
    res.json({
      message: 'تم إنشاء جلسة الدفع',
      paymentUrl: session.paymentUrl,
      orderId: session.orderId,
      signature: session.signature,
      mid: session.mid,
      amount: session.amount,
      currency: session.currency,
      mode: session.mode,
    });
  } catch (error) {
    console.error('Kashier error:', error.response?.data || error.message);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء جلسة الدفع' });
  }
}

async function verifyKashierPaymentHandler(req, res) {
  try {
    const { merchant_order_id, ride_id } = req.query;
    const rideId = ride_id || merchant_order_id;
    if (!rideId) return res.status(400).json({ error: 'معرف الرحلة مطلوب' });

    const ride = await prisma.rideRequest.findUnique({
      where: { id: rideId },
      select: { id: true, isPaid: true, paidAt: true, price: true, paymentMethod: true, driverId: true, status: true },
    });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });

    // إن لم تكن مدفوعة بعد، استعلم كاشير Server-side قبل تحديث قاعدة البيانات
    if (!ride.isPaid) {
      const remote = await queryKashierTransaction(rideId);
      if (remote?.paid) {
        if ((ride.paymentMethod || 'wallet') === 'card') {
          // الدفع ببطاقة: سوّي مالياً (أرباح الكابتن) بعد تأكيد كاشير فقط
          await settleRide(null, { rideId, driverId: ride.driverId });
        } else {
          // المحفظة: التسوية تمت عند الإكمال — نؤكّد الدفع فقط
          await prisma.rideRequest.update({ where: { id: rideId }, data: { isPaid: true, paidAt: new Date() } });
        }
        ride.isPaid = true;
      }
    }

    res.json({ status: ride.isPaid ? 'success' : 'pending', rideId: ride.id, amount: ride.price, paidAt: ride.paidAt });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في التحقق من الدفع' });
  }
}

async function rateRideHandler(req, res) {
  try {
    const rating = await rateRide(req.user.userId, req.body);
    res.status(201).json({ message: 'تم إضافة التقييم', rating });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ أثناء إضافة التقييم' });
  }
}

async function getRatingsHandler(req, res) {
  try {
    const { userId } = req.params;
    if (req.user.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'غير مصرح لك برؤية هذه التقييمات' });
    }

    const ratings = await prisma.rating.findMany({
      where: { toUserId: userId },
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true, role: true } },
        ride: { select: { id: true, pickupPoint: true, dropoffPoint: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ratings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب التقييمات' });
  }
}

module.exports = {
  getRideOptionsHandler,
  calculateRideFareHandler,
  requestRideHandler,
  getCurrentRideHandler,
  getRideHistoryHandler,
  cancelRideHandler,
  initiateKashierPaymentHandler,
  verifyKashierPaymentHandler,
  rateRideHandler,
  getRatingsHandler,
};
