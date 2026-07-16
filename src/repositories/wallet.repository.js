module.exports = ({ prisma }) => ({
  async ensureWallet(userId) {
    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId, balance: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
      });
    }
    return wallet;
  },

  async getWallet(userId) {
    const wallet = await this.ensureWallet(userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    return { wallet, user };
  },

  async getTransactions(walletId, take = 50) {
    return prisma.walletTransaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  },

  async getWithdraws(walletId, take = 50) {
    return prisma.withdrawRequest.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  },

  async createTransaction(walletId, data) {
    return prisma.walletTransaction.create({ data: { walletId, ...data } });
  },

  async createWithdraw(walletId, data) {
    return prisma.withdrawRequest.create({ data: { walletId, ...data } });
  },

  async updateWallet(walletId, data) {
    return prisma.wallet.update({ where: { id: walletId }, data });
  },
});
