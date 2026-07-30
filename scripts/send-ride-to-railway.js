/**
 * هذا السكريبت يرسل طلب رحلة حقيقي إلى سيرفر Railway المنشور
 * بغرض وصول الحدث لتطبيق الكابتن الحقيقي عبر Socket.IO
 */
const jwt = require('jsonwebtoken');
const http = require('http');
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const JWT_SECRET = process.env.JWT_SECRET || 'wasalny_super_secret_key_change_me';
const RAILWAY_URL = 'https://wasalny-backend-production.up.railway.app';

// === 1. التحقق من بيانات الكابتن الحقيقي ===
async function checkCaptain() {
  const prisma = new PrismaClient();
  try {
    const captainId = 'cms54nicr0001o20pcr1ymnjg';
    const captain = await prisma.user.findUnique({
      where: { id: captainId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        phoneNumber: true,
        isActive: true,
        driverProfile: {
          select: {
            isAvailable: true,
            currentLat: true,
            currentLng: true,
            carModel: true,
            carPlateNumber: true,
            vehicleType: true,
            verificationStatus: true,
          },
        },
        wallet: { select: { balance: true } },
      },
    });

    console.log('=== بيانات الكابتن الحقيقي ===');
    console.log(JSON.stringify(captain, null, 2));
    console.log('\n✅ isAvailable:', captain?.driverProfile?.isAvailable);
    console.log('✅ Verification:', captain?.driverProfile?.verificationStatus);
    console.log('⚠️  currentLat:', captain?.driverProfile?.currentLat || 'NULL — لم يتم مشاركة الموقع');
    return prisma;
  } catch (e) {
    console.error('ERROR:', e.message);
    await prisma.$disconnect();
    throw e;
  }
}

// === 2. التحقق من الراكب التجريبي ومحفظته ===
async function checkRider() {
  const prisma = new PrismaClient();
  try {
    const riderId = 'cms795z590000lcx4jl57q9vm';
    const rider = await prisma.user.findUnique({
      where: { id: riderId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        phoneNumber: true,
        wallet: { select: { balance: true, reservedAmount: true } },
      },
    });

    console.log('\n=== بيانات الراكب التجريبي ===');
    console.log(JSON.stringify(rider, null, 2));
    return { prisma, rider };
  } catch (e) {
    console.error('ERROR:', e.message);
    await prisma.$disconnect();
    throw e;
  }
}

// === 3. إنشاء JWT Token للراكب ===
function generateRiderToken(riderId) {
  const token = jwt.sign(
    { userId: riderId, role: 'RIDER' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  console.log('\n=== Rider JWT Token (fresh) ===');
  console.log(token);
  return token;
}

// === 4. إرسال طلب الرحلة إلى Railway ===
function sendRideRequest(token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      originLat: 30.0444,
      originLng: 31.2357,
      destLat: 30.0582,
      destLng: 31.3224,
      pickupAddress: 'ميدان التحرير، القاهرة (E2E Test from Railway)',
      destinationAddress: 'مدينة نصر، القاهرة',
      rideType: 'economy',
      paymentMethod: 'cash',
    });

    const url = new URL(RAILWAY_URL + '/api/v1/rides/request');

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Waslny-E2E-Test/1.0',
      },
    };

    console.log(`\n🌐 Sending ride request to: ${RAILWAY_URL}/api/v1/rides/request`);
    console.log('📦 Body:', body);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('\n📋 HTTP Status:', res.statusCode);
        console.log('📋 Response Headers:', JSON.stringify(res.headers, null, 2));
        console.log('📋 Response Body:', data);
        try {
          const parsed = JSON.parse(data);
          console.log('\n=== الرد الكامل ===');
          console.log(JSON.stringify(parsed, null, 2));
          resolve(parsed);
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (e) => {
      console.error('❌ Request error:', e.message);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

// === MAIN ===
async function main() {
  console.log('🚀 Waslny E2E Test — Railway Production Server\n');
  console.log('═══════════════════════════════════════════');
  console.log('Target:', RAILWAY_URL);
  console.log('═══════════════════════════════════════════\n');

  // Step 1: Check captain
  let prisma1;
  try {
    prisma1 = await checkCaptain();
  } finally {
    if (prisma1) await prisma1.$disconnect();
  }

  // Step 2: Check rider
  let prisma2;
  let rider;
  try {
    const result = await checkRider();
    prisma2 = result.prisma;
    rider = result.rider;
  } finally {
    if (prisma2) await prisma2.$disconnect();
  }

  // Step 3: Generate token
  const token = generateRiderToken(rider.id);

  // Step 4: Send request
  console.log('\n⏳ Sending request...\n');
  const response = await sendRideRequest(token);

  // Step 5: Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('✅ E2E Test Complete');
  console.log('═══════════════════════════════════════════');
  if (response.ride) {
    console.log(`\n🚗 Ride ID: ${response.ride.id}`);
    console.log(`📌 Status: ${response.ride.status}`);
    console.log(`📍 Pickup: ${response.ride.originLat}, ${response.ride.originLng}`);
    console.log(`📍 Destination: ${response.ride.destLat}, ${response.ride.destLng}`);
    console.log(`💰 Price: ${response.ride.price} EGP`);
    console.log(`📏 Distance: ${response.ride.distance} km`);
    console.log(`⏱ Duration: ${response.ride.durationMinutes} min`);
    console.log(`🏍 Ride Type: ${response.ride.rideType}`);
    console.log(`💳 Payment: ${response.ride.paymentMethod}`);
    console.log(`✅ Server: ${RAILWAY_URL} (Production)`);
  }
}

main().catch((e) => {
  console.error('\n❌ Fatal error:', e.message);
  process.exit(1);
});
