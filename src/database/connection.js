const dns = require('dns');
const { PrismaClient } = require('@prisma/client');
const config = require('../config');
const logger = require('../libs/logger');

// Force Node.js to prefer IPv4 over IPv6. Cloud poolers (like Supabase PgBouncer on port 6543)
// often fail or timeout when ISPs attempt synthesized NAT64 (64:ff9b::) routing.
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

/**
 * Singleton Prisma client — reuses the same instance across hot-reloads in development.
 */

/** @type {PrismaClient} */
let prisma;

const clientOptions = {
  datasources: {
    db: {
      url: config.db.url,
    },
  },
  log: config.isProd ? ['error', 'warn'] : ['query', 'info', 'warn', 'error'],
};

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient(clientOptions);
} else {
  // Prevent multiple instances during hot-reload (nodemon)
  if (!global.__prisma) {
    global.__prisma = new PrismaClient(clientOptions);
  }
  prisma = global.__prisma;
}

/**
 * Connect to the database and verify the connection with automatic retry on transient failures.
 * Non-fatal so that temporary network pauses or cold starts don't crash nodemon.
 */
async function connectDatabase(maxRetries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      logger.info('✅ Connected to PostgreSQL database');
      return true;
    } catch (error) {
      logger.warn(`⚠️ Database connection attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) {
        logger.info(`⏳ Retrying database connection in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  logger.warn('⚠️ Could not eagerly establish database connection at startup. Prisma will connect on demand for incoming requests.');
  return false;
}

/**
 * Gracefully disconnect from the database.
 */
async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('🔌 Disconnected from PostgreSQL database');
}

module.exports = { prisma, connectDatabase, disconnectDatabase };
