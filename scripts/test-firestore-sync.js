/**
 * Live end-to-end test for Firestore ride-sync (Stage 1 + Stage 2).
 * Creates temp rider + captain, runs requestRide -> acceptRide -> startRide
 * -> completeRide (wallet), verifies Firestore mirror after each step, then
 * cleans up BOTH PostgreSQL and Firestore.
 *
 * Run: node scripts/test-firestore-sync.js
 */
require('dotenv').config();

const prisma = require('../src/config/prisma');
const { getFirestore } = require('../src/config/firebase');
const { requestRide, cancelRide } = require('../src/services/ride.service');
const { acceptRide, startRide, completeRide } = require('../src/services/captain.service');

// mock socket.io so requestRide's emit() is a no-op
const mockIo = { to: () => ({ emit: () => {} }) };

const TEST_PREFIX = `__TEST_FIRESTORE__`;
const created = { users: [], driverProfiles: [], wallets: [], rideId: null };

function logStep(n, msg, ok, extra) {
  const mark = ok ? '✅' : '❌';
  console.log(`\n[STEP ${n}] ${mark} ${msg}`);
  if (extra !== undefined) console.log('   →', JSON.stringify(extra));
}

async function getFsStatus(rideId) {
  const db = getFirestore();
  const snap = await db.collection('rides').doc(rideId).get();
  return snap.exists ? snap.data().status : '(doc missing)';
}

async function main() {
  console.log('🔥 Firebase project init...');
  getFirestore(); // forces init if needed
  console.log('✅ Firestore reachable\n');

  // ── 1. Create temp rider + captain ──────────────────────
  const rider = await prisma.user.create({
    data: {
      phoneNumber: `+2010000000${Math.floor(Math.random() * 900 + 100)}`,
      firstName: `${TEST_PREFIX}_Rider`,
      lastName: 'Test',
      role: 'RIDER',
      isVerified: true,
    },
  });
  created.users.push(rider.id);

  const riderWallet = await prisma.wallet.create({
    data: { userId: rider.id, balance: 1000, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
  });
  created.wallets.push(riderWallet.id);

  const captain = await prisma.user.create({
    data: {
      phoneNumber: `+2011000000${Math.floor(Math.random() * 900 + 100)}`,
      firstName: `${TEST_PREFIX}_Captain`,
      lastName: 'Test',
      role: 'DRIVER',
      isVerified: true,
    },
  });
  created.users.push(captain.id);

  const driverProfile = await prisma.driverProfile.create({
    data: {
      userId: captain.id,
      carModel: 'Test Car',
      carPlateNumber: 'TEST-123',
      carColor: 'White',
      vehicleType: 'PRIVATE_CAR',
      serviceTier: 'ECO',
      carPhotoUrl: 'https://example.com/test.jpg',
      isAvailable: true,
    },
  });
  created.driverProfiles.push(driverProfile.id);

  const capWallet = await prisma.wallet.create({
    data: { userId: captain.id, balance: 0, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
  });
  created.wallets.push(capWallet.id);

  logStep(1, 'Created temp rider + captain', true, {
    riderId: rider.id, captainId: captain.id,
  });

  // ── 2. requestRide ─────────────────────────────────────
  const ride = await requestRide(rider.id, {
    pickupAddress: 'Test Pickup',
    destinationAddress: 'Test Destination',
    originLat: 30.0444, originLng: 31.2357,
    destLat: 30.0500, destLng: 31.2400,
    rideType: 'economy',
    paymentMethod: 'wallet',
  }, mockIo);
  created.rideId = ride.id;

  const fsAfterRequest = await getFsStatus(ride.id);
  const pgAfterRequest = await prisma.rideRequest.findUnique({ where: { id: ride.id }, select: { status: true } });
  logStep(2, 'requestRide -> Firestore + PostgreSQL',
    fsAfterRequest === 'pending' && pgAfterRequest.status === 'PENDING',
    { firestore: fsAfterRequest, postgres: pgAfterRequest.status, rideId: ride.id });

  // ── 3. acceptRide ──────────────────────────────────────
  await acceptRide(captain.id, ride.id);
  const fsAfterAccept = await getFsStatus(ride.id);
  const pgAfterAccept = await prisma.rideRequest.findUnique({ where: { id: ride.id }, select: { status: true, driverId: true } });
  logStep(3, 'acceptRide -> Firestore status',
    fsAfterAccept === 'accepted' && pgAfterAccept.status === 'ACCEPTED',
    { firestore: fsAfterAccept, postgres: pgAfterAccept.status });

  // ── 4. startRide ───────────────────────────────────────
  await startRide(captain.id, ride.id);
  const fsAfterStart = await getFsStatus(ride.id);
  const pgAfterStart = await prisma.rideRequest.findUnique({ where: { id: ride.id }, select: { status: true } });
  logStep(4, 'startRide -> Firestore status',
    fsAfterStart === 'started' && pgAfterStart.status === 'STARTED',
    { firestore: fsAfterStart, postgres: pgAfterStart.status });

  // ── 5. completeRide (wallet) ───────────────────────────
  await completeRide(captain.id, ride.id);
  const fsAfterComplete = await getFsStatus(ride.id);
  const pgAfterComplete = await prisma.rideRequest.findUnique({ where: { id: ride.id }, select: { status: true, isPaid: true } });
  logStep(5, 'completeRide (wallet) -> Firestore + PostgreSQL',
    fsAfterComplete === 'completed' && pgAfterComplete.status === 'COMPLETED' && pgAfterComplete.isPaid,
    { firestore: fsAfterComplete, postgres: pgAfterComplete.status, isPaid: pgAfterComplete.isPaid });

  console.log('\n🎉 All sync steps verified successfully.');
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  try {
    if (created.rideId) {
      const db = getFirestore();
      await db.collection('rides').doc(created.rideId).delete();
      console.log('   • Firestore ride doc deleted');
    }
  } catch (e) {
    console.log('   ⚠️ Firestore cleanup error:', e.message);
  }
  try {
    if (created.rideId) {
      // must delete child WalletTransactions BEFORE the RideRequest (FK is RESTRICT)
      await prisma.walletTransaction.deleteMany({ where: { rideId: created.rideId } });
      await prisma.rideRequest.deleteMany({ where: { id: created.rideId } });
    }
    await prisma.driverProfile.deleteMany({ where: { id: { in: created.driverProfiles } } });
    await prisma.wallet.deleteMany({ where: { id: { in: created.wallets } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    console.log('   • PostgreSQL test rows deleted (users, driverProfiles, wallets, ride, transactions)');
  } catch (e) {
    console.log('   ⚠️ PostgreSQL cleanup error:', e.message);
  }
}

main()
  .catch((e) => {
    console.error('\n❌ TEST FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log('\n✅ Done. Exiting.');
    process.exit(process.exitCode || 0);
  });
