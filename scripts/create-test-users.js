const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'wasalny_super_secret_key_change_me';

function generateToken(userId, role, expiresIn = '30d') {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn });
}

async function main() {
  // Check if test rider exists
  let rider = await prisma.user.findFirst({ where: { phoneNumber: '+201000000001' } });
  if (!rider) {
    rider = await prisma.user.create({
      data: {
        phoneNumber: '+201000000001',
        firstName: 'Test',
        lastName: 'Rider',
        role: 'RIDER',
        isVerified: true,
      },
    });
    // Create wallet for rider
    await prisma.wallet.create({
      data: { userId: rider.id, balance: 500, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
    });
    console.log('✅ Created RIDER:', rider.id);
  } else {
    console.log('✅ Found existing RIDER:', rider.id);
  }

  // Check if test captain exists
  let captain = await prisma.user.findFirst({ where: { phoneNumber: '+201000000002' } });
  if (!captain) {
    captain = await prisma.user.create({
      data: {
        phoneNumber: '+201000000002',
        firstName: 'Test',
        lastName: 'Captain',
        role: 'CAPTAIN',
        isVerified: true,
      },
    });
    // Create wallet for captain
    await prisma.wallet.create({
      data: { userId: captain.id, balance: 0, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
    });
    // Create driver profile with a location in Cairo
    await prisma.driverProfile.create({
      data: {
        userId: captain.id,
        carModel: 'Toyota Corolla 2023',
        carPlateNumber: 'ABC123',
        carColor: 'White',
        vehicleType: 'PRIVATE_CAR',
        serviceTier: 'ECO',
        carPhotoUrl: '',
        isAvailable: true,
        currentLat: 30.0444,  // Downtown Cairo
        currentLng: 31.2357,
      },
    });
    console.log('✅ Created CAPTAIN:', captain.id);
  } else {
    console.log('✅ Found existing CAPTAIN:', captain.id);
    // Ensure the captain has a driver profile and is available
    const profile = await prisma.driverProfile.findUnique({ where: { userId: captain.id } });
    if (profile) {
      // Update location and availability
      await prisma.driverProfile.update({
        where: { userId: captain.id },
        data: { isAvailable: true, currentLat: 30.0444, currentLng: 31.2357 },
      });
      console.log('✅ Updated CAPTAIN profile - Available, location set');
    } else {
      await prisma.driverProfile.create({
        data: {
          userId: captain.id,
          carModel: 'Toyota Corolla 2023',
          carPlateNumber: 'ABC123',
          carColor: 'White',
          vehicleType: 'PRIVATE_CAR',
          serviceTier: 'ECO',
          carPhotoUrl: '',
          isAvailable: true,
          currentLat: 30.0444,
          currentLng: 31.2357,
        },
      });
      console.log('✅ Created CAPTAIN profile');
    }
  }

  // Generate JWT tokens
  const riderToken = generateToken(rider.id, rider.role);
  const captainToken = generateToken(captain.id, captain.role);

  console.log('\n=== RIDER TOKEN ===');
  console.log(riderToken);
  console.log('\n=== CAPTAIN TOKEN ===');
  console.log(captainToken);
  console.log('\n=== RIDER INFO ===');
  console.log(JSON.stringify({ id: rider.id, role: rider.role }, null, 2));
  console.log('\n=== CAPTAIN INFO ===');
  console.log(JSON.stringify({ id: captain.id, role: captain.role, profile: captain.driverProfile || 'check below' }, null, 2));

  // Show captain profile separately
  const capProfile = await prisma.driverProfile.findUnique({ where: { userId: captain.id } });
  console.log('\n=== CAPTAIN PROFILE ===');
  console.log(JSON.stringify(capProfile, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  prisma.$disconnect();
});
