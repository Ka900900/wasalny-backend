const http = require('http');

const riderToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXM3OTV6NTkwMDAwbGN4NGpsNTdxOXZtIiwicm9sZSI6IlJJREVSIiwiaWF0IjoxNzg1NDAwMTc1LCJleHAiOjE3ODc5OTIxNzV9.0tLj19L_JdEJ9EtixhXN-hTVVBL_ldRbtvJbZ8aePKA';

const body = JSON.stringify({
  originLat: 30.0444,
  originLng: 31.2357,
  destLat: 30.0582,
  destLng: 31.3224,
  pickupAddress: 'ميدان التحرير، القاهرة',
  destinationAddress: 'مدينة نصر، القاهرة',
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
    console.log('Status:', res.statusCode);
    console.log('Headers:', JSON.stringify(res.headers, null, 2));
    console.log('Body:', data);
    try {
      const parsed = JSON.parse(data);
      console.log('Parsed:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Raw body:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(body);
req.end();
