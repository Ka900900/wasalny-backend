const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'cms54nicr0001o20pcr1ymnjg'; // Karim's ID

  // Get existing driver profile
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) {
    console.log('No driver profile found');
    return;
  }

  console.log('Current driver profile:', JSON.stringify(profile, null, 2));

  // Parse carModel into make and model
  const parts = (profile.carModel || '').trim().split(/\s+/);
  const make = parts[0] || '';
  const model = parts.slice(1).join(' ') || '';

  // Create or update Vehicle record
  const vehicle = await prisma.vehicle.upsert({
    where: { plateNumber: profile.carPlateNumber || 'UNKNOWN' },
    update: {
      make,
      model,
      color: profile.carColor || '',
      vehicleType: profile.vehicleType || 'PRIVATE_CAR',
      year: 2020,
      userId,
    },
    create: {
      userId,
      make,
      model,
      color: profile.carColor || '',
      plateNumber: profile.carPlateNumber || 'UNKNOWN',
      vehicleType: profile.vehicleType || 'PRIVATE_CAR',
      year: 2020,
      licenseFrontUrl: profile.carPhotoUrl || '',
      licenseBackUrl: '',
    },
  });

  console.log('Vehicle record created/updated:', JSON.stringify(vehicle, null, 2));
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
