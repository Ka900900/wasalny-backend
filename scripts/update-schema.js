const fs = require('fs');
const path = require('path');

const schema = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  phoneNumber  String   @unique
  firstName    String
  lastName     String
  role         String   @default("RIDER")
  isVerified   Boolean  @default(false)
  otpCode      String?
  otpExpiresAt DateTime?
  avatarUrl    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  ridesAsRider    RideRequest[] @relation("RiderRides")
  ridesAsDriver   RideRequest[] @relation("DriverRides")
  driverProfile   DriverProfile?
  ratingsGiven    Rating[] @relation("RatingsGiven")
  ratingsReceived Rating[] @relation("RatingsReceived")
  wallet          Wallet?
}

model DriverProfile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  carModel       String
  carPlateNumber String
  carColor       String
  isAvailable    Boolean  @default(true)
  currentLat     Float?
  currentLng     Float?
  balance        Float    @default(0)
  totalTrips     Int      @default(0)
  totalEarnings  Float    @default(0)
  ratingAvg      Float    @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model RideOption {
  id              String   @id @default(cuid())
  name            String
  nameAr          String
  description     String
  descriptionAr   String
  icon            String
  capacity        Int      @default(4)
  baseFare        Float    @default(10)
  pricePerKm      Float    @default(4)
  pricePerMinute  Float    @default(0.75)
  multiplier      Float    @default(1.0)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  rides RideRequest[]
}

model RideRequest {
  id           String   @id @default(cuid())
  riderId      String
  rider        User     @relation("RiderRides", fields: [riderId], references: [id])

  rideOptionId String?
  rideOption   RideOption? @relation(fields: [rideOptionId], references: [id])
  rideType     String?

  pickupPoint        String
  pickupAddress      String  @default("")
  dropoffPoint       String
  destinationAddress String @default("")
  originLat          Float
  originLng          Float
  destLat            Float
  destLng            Float

  price           Float
  distance        Float
  durationMinutes Int @default(0)
  pricePerKm      Float @default(7)
  commission      Float @default(0)
  driverEarning   Float @default(0)

  status       String  @default("PENDING")
  isPaid       Boolean @default(false)
  paidAt       DateTime?
  paymentMethod String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  driverId String?
  driver   User? @relation("DriverRides", fields: [driverId], references: [id])

  rating Rating?

  driverCurrentLat Float?
  driverCurrentLng Float?
  driverEtaMinutes Int?
}

model Rating {
  id         String   @id @default(cuid())
  rideId     String   @unique
  ride       RideRequest @relation(fields: [rideId], references: [id], onDelete: Cascade)
  fromUserId String
  fromUser   User     @relation("RatingsGiven", fields: [fromUserId], references: [id])
  toUserId   String
  toUser     User     @relation("RatingsReceived", fields: [toUserId], references: [id])
  rating     Int
  comment    String?
  createdAt  DateTime @default(now())
}

model Wallet {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  balance         Float    @default(0)
  pendingWithdraw Float    @default(0)
  totalEarned     Float    @default(0)
  totalWithdrawn  Float    @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  transactions   WalletTransaction[]
  withdraws      WithdrawRequest[]
  paymentMethods PaymentMethod[]
}

model WalletTransaction {
  id          String   @id @default(cuid())
  walletId    String
  wallet      Wallet   @relation(fields: [walletId], references: [id], onDelete: Cascade)
  type        String
  amount      Float
  description String
  status      String   @default("completed")
  rideId      String?
  createdAt   DateTime @default(now())
}

model WithdrawRequest {
  id             String   @id @default(cuid())
  walletId       String
  wallet         Wallet   @relation(fields: [walletId], references: [id], onDelete: Cascade)
  amount         Float
  status         String   @default("pending")
  bankName       String?
  bankAccount    String?
  accountHolder  String?
  rejectReason   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model PaymentMethod {
  id            String   @id @default(cuid())
  walletId      String
  wallet        Wallet   @relation(fields: [walletId], references: [id], onDelete: Cascade)
  type          String
  brand         String?
  lastFour      String?
  cardholderName String?
  expiryDate    String?
  isDefault     Boolean  @default(false)
  createdAt     DateTime @default(now())
}
`;

const schemaPath = path.join('g:', 'wasalny-project', 'prisma', 'schema.prisma');
fs.writeFileSync(schemaPath, schema, 'utf8');
console.log('✅ Schema written successfully to', schemaPath);
