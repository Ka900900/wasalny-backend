/**
 * إرسال طلب رحلة إلى سيرفر Railway المنشور
 * باستخدام JWT_SECRET الحقيقي من Railway
 */
const https = require('https');

const RAILWAY_URL = 'https://wasalny-backend-production.up.railway.app';
const RIDER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXM3OTV6NTkwMDAwbGN4NGpsNTdxOXZtIiwicm9sZSI6IlJJREVSIiwiaWF0IjoxNzg1NDA0MzU5LCJleHAiOjE3ODc5OTYzNTl9.PUYjKT0WN1DSz4_AgEB5SbdCgz0iH_0HiUeDqUlo_bk';

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
    'Authorization': `Bearer ${RIDER_TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'Waslny-E2E-Test/1.0',
  },
};

console.log(`🌐 Sending ride request to: ${RAILWAY_URL}/api/v1/rides/request`);
console.log('📦 Body:', body);
console.log('🔑 Token (first 50 chars):', RIDER_TOKEN.substring(0, 50) + '...');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('\n📋 HTTP Status:', res.statusCode);
    console.log('📋 Response Body:', data);
    try {
      const parsed = JSON.parse(data);
      console.log('\n=== ✅ الرد الكامل ===');
      console.log(JSON.stringify(parsed, null, 2));
      if (parsed.ride) {
        console.log('\n═══════════════════════════════════════');
        console.log('🚀 تم إنشاء الرحلة بنجاح على Railway!');
        console.log('═══════════════════════════════════════');
        console.log(`🆔 Ride ID: ${parsed.ride.id}`);
        console.log(`📌 Status: ${parsed.ride.status}`);
        console.log(`📍 Pickup: ${parsed.ride.originLat}, ${parsed.ride.originLng}`);
        console.log(`📍 Dest:   ${parsed.ride.destLat}, ${parsed.ride.destLng}`);
        console.log(`💰 Price: ${parsed.ride.price} EGP`);
        console.log(`📏 Distance: ${parsed.ride.distance} km`);
        console.log(`⏱ Duration: ${parsed.ride.durationMinutes} min`);
        console.log(`🏍 Type: ${parsed.ride.rideType}`);
        console.log(`🌐 Server: ${RAILWAY_URL}`);
        console.log('═══════════════════════════════════════');
      }
    } catch (e) {
      console.log('📋 Raw response (not JSON)');
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
});

req.write(body);
req.end();
