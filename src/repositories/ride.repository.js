module.exports = ({ prisma }) => ({
  async findById(rideId) {
    return prisma.rideRequest.findUnique({ where: { id: rideId } });
  },

  async create(data) {
    return prisma.rideRequest.create({ data });
  },

  async update(rideId, data) {
    return prisma.rideRequest.update({ where: { id: rideId }, data });
  },

  async getCurrentRide(userId) {
    return prisma.rideRequest.findFirst({
      where: {
        OR: [{ riderId: userId }, { driverId: userId }],
        status: { in: ['PENDING', 'ACCEPTED', 'STARTED'] },
      },
      include: {
        rider: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        driver: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, driverProfile: true } },
        rideOption: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getHistory(userId) {
    return prisma.rideRequest.findMany({
      where: {
        OR: [{ riderId: userId }, { driverId: userId }],
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        rider: { select: { id: true, firstName: true, lastName: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
        rating: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },

  async getActiveRidesForDriver(driverId) {
    return prisma.rideRequest.findMany({
      where: {
        driverId,
        status: { in: ['ACCEPTED', 'STARTED'] },
      },
      select: { id: true },
    });
  },

  async getPendingRides() {
    return prisma.rideRequest.findMany({
      where: { status: 'PENDING' },
      include: { rider: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getRatings(userId) {
    return prisma.rating.findMany({
      where: { toUserId: userId },
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true, role: true } },
        ride: { select: { id: true, pickupPoint: true, dropoffPoint: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
});
