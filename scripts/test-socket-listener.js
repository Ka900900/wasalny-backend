/**
 * هذا السكريبت يتصل بالسيرفر عبر Socket.IO كـ "كابتن"
 * للاستماع إلى حدث NEW_RIDE_AVAILABLE وإثبات وصوله.
 */
const { io: SocketIOClient } = require('socket.io-client');
const http = require('http');

const SERVER_URL = 'http://127.0.0.1:3000';
const captainToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXM3OTV6ajAwMDAzbGN4NDUyaWdpMDd5Iiwicm9sZSI6IkNBUFRBSU4iLCJpYXQiOjE3ODU0MDAxNzUsImV4cCI6MTc4Nzk5MjE3NX0.UJTL0tFtlD8zwtBFJj87up1JA9MZ-iYPh_P82cBlqfI';
const riderToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXM3OTV6NTkwMDAwbGN4NGpsNTdxOXZtIiwicm9sZSI6IlJJREVSIiwiaWF0IjoxNzg1NDAwMTc1LCJleHAiOjE3ODc5OTIxNzV9.0tLj19L_JdEJ9EtixhXN-hTVVBL_ldRbtvJbZ8aePKA';

console.log('🔌 Connecting to Socket.IO server as captain...');

const socket = SocketIOClient(SERVER_URL, {
  auth: { token: captainToken },
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
  console.log('✅ Socket connected! ID:', socket.id);
  console.log('🚖 Joining drivers room...');

  // انضم إلى غرفة الكابتن والكباتن
  socket.emit('join_driver', {
    userId: 'cms795zj00003lcx452igi07y',
  });

  // استمع لحدث الرحلة الجديدة
  socket.on('ride.new_available', (data) => {
    console.log('\n🚗🚗🚗 NEW_RIDE_AVAILABLE EVENT RECEIVED! 🚗🚗🚗');
    console.log('📦 Event data:', JSON.stringify(data, null, 2));
    console.log('✅ PROOF: Socket.IO event ride.new_available was emitted and received successfully!\n');

    // بعد استلام الحدث، انتظر ثانية ثم أغلق الاتصال
    setTimeout(() => {
      socket.close();
      process.exit(0);
    }, 1000);
  });

  // استمع لأحداث أخرى
  socket.on('ride.request_update', (data) => {
    console.log('🔄 Ride update:', data);
  });

  // الآن ابدأ طلب رحلة جديدة (كـ راكب)
  console.log('\n📱 Sending ride request as rider...');
  setTimeout(() => {
    const body = JSON.stringify({
      originLat: 30.0444,
      originLng: 31.2357,
      destLat: 30.0582,
      destLng: 31.3224,
      pickupAddress: 'ميدان التحرير، القاهرة (Test 2)',
      destinationAddress: 'مدينة نصر، القاهرة (Test 2)',
      rideType: 'economy',
      paymentMethod: 'cash',
    });

    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/v1/rides/request',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${riderToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`📋 HTTP Response: ${res.statusCode}`);
        const parsed = JSON.parse(data);
        console.log('📋 Ride created:', parsed.ride?.id);
        console.log('📋 Status:', parsed.ride?.status);
      });
    });

    req.on('error', (e) => {
      console.error('❌ HTTP Error:', e.message);
    });

    req.write(body);
    req.end();
  }, 1000); // انتظر ثانية بعد اتصال السوكيت
});

socket.on('connect_error', (err) => {
  console.error('❌ Socket connect error:', err.message);
});

// إنهاء بعد 15 ثانية إذا لم يحدث شيء
setTimeout(() => {
  console.log('⏰ Timeout - no event received');
  socket.close();
  process.exit(1);
}, 15000);
