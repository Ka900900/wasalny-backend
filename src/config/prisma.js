const { PrismaClient } = require("@prisma/client");

/**
 * Enhanced Prisma client with reconnection logic for Neon/PostgreSQL.
 * Handles 'terminating connection due to administrator command' (E57P01)
 * and other transient connection errors by retrying failed queries.
 *
 * Neon serverless Postgres may terminate idle connections (E57P01 / P1017).
 * This module provides:
 *  - Connection pool configuration optimized for Neon
 *  - Automatic reconnection on detected connection errors
 *  - A `withRetry()` utility for wrapping critical database operations
 *  - Keep-alive queries to prevent connection idle timeout
 *  - Graceful shutdown handlers
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes (Neon idle timeout is ~5 min)

let prisma;
let keepaliveTimer = null;

function createPrismaClient() {
  // ── Connection Pool Configuration ────────────────────
  // Neon/PostgreSQL connection pooling is configured via DATABASE_URL params:
  //   ?pgbouncer=true&connection_limit=5&pool_timeout=15
  // The PrismaClient itself uses these URL-level settings.
  //
  // Logging: warn & error only (query logs disabled for performance)
  const client = new PrismaClient({
    log: ["warn", "error"],
  });

  return client;
}

/**
 * Periodically run a lightweight query to keep the Neon connection alive.
 * Neon typically terminates idle connections after ~5 minutes of inactivity.
 */
function startKeepalive() {
  stopKeepalive(); // clear any existing timer
  keepaliveTimer = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.warn('[Prisma] Keepalive query failed, connection may have been closed:', err.message);
    }
  }, KEEPALIVE_INTERVAL_MS);
  keepaliveTimer.unref(); // don't prevent process exit
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

/**
 * Execute a database operation with automatic retry on connection errors.
 * Useful for wrapping critical database operations that should survive transient failures.
 *
 * @param {Function} operation - Async function that performs a Prisma query
 * @param {number} retries - Remaining retry count (default: MAX_RETRIES)
 * @returns {Promise<any>} - Result of the operation
 *
 * @example
 *   const user = await withRetry(() => prisma.user.findUnique({ where: { id } }));
 */
async function withRetry(operation, retries = MAX_RETRIES) {
  try {
    return await operation();
  } catch (error) {
    // Check if it's a connection error that warrants a retry
    const isConnectionError =
      error.code === 'P1001' || // Can't reach database
      error.code === 'P1002' || // Connection timed out
      error.code === 'P1008' || // Operations timed out (connection pool)
      error.code === 'P1017' || // Server closed the connection (E57P01)
      (error.message && (
        error.message.includes('terminating connection') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('server closed the connection') ||
        error.message.includes('connection pool')
      ));

    if (!isConnectionError || retries <= 0) {
      throw error;
    }

    const attempt = MAX_RETRIES - retries + 1;
    console.warn(`[Prisma] Connection error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${BASE_DELAY_MS * Math.pow(2, attempt - 1)}ms: ${error.message}`);

    // Exponential backoff
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    await new Promise(resolve => setTimeout(resolve, delay));

    return withRetry(operation, retries - 1);
  }
}

// ── Initialize ───────────────────────────────────────
prisma = createPrismaClient();
startKeepalive();

// ── Graceful shutdown ────────────────────────────────
async function shutdown() {
  stopKeepalive();
  try {
    await prisma.$disconnect();
  } catch (_) { /* ignore */ }
}

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

module.exports = prisma;
module.exports.withRetry = withRetry;

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
