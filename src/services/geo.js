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
 * Price per km based on peak/off-peak hours.
 */
function getPricePerKm() {
  const hour = new Date().getHours();
  const isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19);
  return isPeakHour ? 13 : 7;
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

module.exports = {
  haversineDistance,
  getPricePerKm,
  calculateDistance,
  calculateFare,
  estimateDuration,
};
