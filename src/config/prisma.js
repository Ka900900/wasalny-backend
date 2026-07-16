const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: ["query", "warn", "error"],
});

module.exports = prisma;
