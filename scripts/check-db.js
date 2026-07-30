const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check what tables exist
  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('=== TABLES ===');
  console.log(JSON.stringify(tables, null, 2));

  // Check migration status
  const migrations = await prisma.$queryRawUnsafe(
    "SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10"
  );
  console.log('=== MIGRATIONS ===');
  console.log(JSON.stringify(migrations, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  prisma.$disconnect();
});
