/**
 * Geo service — distance calculation & pricing logic.
 */

/**
 * Haversine distance between two lat/lng points (in km).
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check whether the current time is within peak hours.
 * Peak hours: 7–9 AM and 4–7 PM (server local time).
 * @param {Date} [date]
 * @returns {boolean}
 */
function isPeakHourNow(date = new Date()) {
  const hour = date.getHours();
  return (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19);
}

/**
 * Price per km based on peak/off-peak hours.
 * Cars (economy/comfort/premium/xl): 7 EGP off-peak, 15 EGP peak.
 * Motorcycle = 50% of car price; Scooter = 1/3 of car price
 * (both follow the same peak/off-peak logic so they stay proportional).
 * @param {string} [rideOptionName]
 */
function getPricePerKm(rideOptionName) {
  const carPricePerKm = isPeakHourNow() ? 15 : 7;
  if (rideOptionName === 'motorcycle') {
    return parseFloat((carPricePerKm * 0.5).toFixed(2)); // نصف سعر السيارة
  }
  if (rideOptionName === 'scooter') {
    return parseFloat((carPricePerKm * (1 / 3)).toFixed(2)); // ثلث سعر السيارة
  }
  return carPricePerKm;
}

/**
 * Calculate ride distance using OpenRouteService API, fallback to Haversine.
 */
async function calculateDistance(originLat, originLng, destLat, destLng) {
  const ORS_API_KEY = process.env.ORS_API_KEY;

  if (ORS_API_KEY) {
    try {
      const axios = require('axios');
      const response = await axios.post(
        'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
        { coordinates: [[originLng, originLat], [destLng, destLat]] },
        {
          headers: {
            Authorization: ORS_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );
      const distanceM =
        response.data.features[0].properties.segments[0].distance;
      return distanceM / 1000; // convert to km
    } catch (err) {
      console.warn('ORS API failed, falling back to Haversine:', err.message);
    }
  }
  return haversineDistance(originLat, originLng, destLat, destLng);
}

/**
 * Calculate full fare including base fare, distance, duration, and commission.
 * All values are passed as parameters (no env reads) so pricing stays consistent
 * across endpoints and is driven by RideOption + Config (commissionRate).
 *
 * @param {object} params
 * @param {number} params.distanceKm
 * @param {number} [params.durationMinutes=0]
 * @param {number} [params.baseFare=0]       - from RideOption.baseFare
 * @param {number} params.pricePerKm         - from getPricePerKm() or RideOption.pricePerKm
 * @param {number} [params.pricePerMinute=0] - from RideOption.pricePerMinute
 * @param {number} params.commissionRate     - decimal (e.g. 0.12) from getCommissionRate()
 */
function calculateFare({ distanceKm, durationMinutes = 0, baseFare = 0, pricePerKm, pricePerMinute = 0, commissionRate }) {
  const distanceCost = distanceKm * pricePerKm;
  const timeCost = durationMinutes * pricePerMinute;
  const totalPrice = parseFloat((baseFare + distanceCost + timeCost).toFixed(2));

  const commission = parseFloat((totalPrice * commissionRate).toFixed(2));
  const driverEarning = parseFloat((totalPrice - commission).toFixed(2));

  return { price: totalPrice, pricePerKm, baseFare, pricePerMinute, durationMinutes, commissionRate, commission, driverEarning };
}

/**
 * Estimate duration in minutes based on distance and average speed.
 */
function estimateDuration(distanceKm, avgSpeedKmph = 30) {
  return Math.ceil((distanceKm / avgSpeedKmph) * 60);
}

/**
 * محافظات مصر — تُستخدم لتحديد محافظة الكابتن تلقائيًا من إحداثياته عند التسجيل.
 * كل محافظة لها مركز تقريبي + نصف قطر تغطية (كم).
 */
const EGYPT_GOVERNORATES = [
  { name: 'القاهرة', lat: 30.0444, lng: 31.2357, radiusKm: 18 },
  { name: 'الجيزة', lat: 30.0131, lng: 31.2089, radiusKm: 22 },
  { name: 'الإسكندرية', lat: 31.2001, lng: 29.9187, radiusKm: 18 },
  { name: 'القليوبية', lat: 30.4618, lng: 31.1856, radiusKm: 15 },
  { name: 'الشرقية', lat: 30.5877, lng: 31.5021, radiusKm: 20 },
  { name: 'الدقهلية', lat: 31.04, lng: 31.38, radiusKm: 18 },
  { name: 'المنوفية', lat: 30.5528, lng: 30.8977, radiusKm: 15 },
  { name: 'الغربية', lat: 30.7865, lng: 31.0004, radiusKm: 15 },
  { name: 'كفر الشيخ', lat: 31.1043, lng: 30.9447, radiusKm: 15 },
  { name: 'البحيرة', lat: 31.0333, lng: 30.4667, radiusKm: 18 },
  { name: 'دمياط', lat: 31.4165, lng: 31.8133, radiusKm: 14 },
  { name: 'بورسعيد', lat: 31.2565, lng: 32.2841, radiusKm: 15 },
  { name: 'الإسماعيلية', lat: 30.6042, lng: 32.2654, radiusKm: 15 },
  { name: 'السويس', lat: 29.9668, lng: 32.5498, radiusKm: 14 },
  { name: 'شمال سيناء', lat: 31.0245, lng: 33.5995, radiusKm: 20 },
  { name: 'جنوب سيناء', lat: 28.9924, lng: 34.1857, radiusKm: 25 },
  { name: 'البحر الأحمر', lat: 25.5778, lng: 33.5484, radiusKm: 25 },
  { name: 'الفيوم', lat: 29.3084, lng: 30.8428, radiusKm: 18 },
  { name: 'بني سويف', lat: 29.0716, lng: 31.0996, radiusKm: 16 },
  { name: 'المنيا', lat: 28.1099, lng: 30.7503, radiusKm: 20 },
  { name: 'أسيوط', lat: 27.1809, lng: 31.1837, radiusKm: 16 },
  { name: 'سوهاج', lat: 26.5565, lng: 31.6958, radiusKm: 16 },
  { name: 'قنا', lat: 26.1642, lng: 32.7262, radiusKm: 15 },
  { name: 'الأقصر', lat: 25.6872, lng: 32.6396, radiusKm: 13 },
  { name: 'أسوان', lat: 24.0889, lng: 32.8998, radiusKm: 18 },
  { name: 'مطروح', lat: 31.352, lng: 27.237, radiusKm: 30 },
  { name: 'الوادي الجديد', lat: 25.5293, lng: 29.2066, radiusKm: 40 },
];

/**
 * يحدّد محافظة الكابتن تلقائيًا من إحداثياته (أقرب مركز ضمن نصف قطره).
 * @param {number} lat
 * @param {number} lng
 * @returns {string|null} اسم المحافظة (عربي) أو null إن لم تكن ضمن أي محافظة معروفة
 */
function getGovernorateFromCoords(lat, lng) {
  if (
    typeof lat !== 'number' || typeof lng !== 'number' ||
    Number.isNaN(lat) || Number.isNaN(lng)
  ) {
    return null;
  }
  let best = null;
  let bestDist = Infinity;
  for (const g of EGYPT_GOVERNORATES) {
    const dist = haversineDistance(lat, lng, g.lat, g.lng);
    if (dist <= g.radiusKm && dist < bestDist) {
      best = g.name;
      bestDist = dist;
    }
  }
  return best;
}

module.exports = {
  haversineDistance,
  getPricePerKm,
  isPeakHourNow,
  calculateDistance,
  calculateFare,
  estimateDuration,
  getGovernorateFromCoords,
};
