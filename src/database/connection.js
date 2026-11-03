const { PrismaClient } = require('@prisma/client');
const logger = require('../libs/logger');

/**
 * Singleton Prisma client — reuses the same instance across hot-reloads in development.
 */

/** @type {PrismaClient} */
let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['error', 'warn'],
  });
} else {
  // Prevent multiple instances during hot-reload (nodemon)
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    });
  }
  prisma = global.__prisma;
}

/**
 * Connect to the database and verify the connection.
 */
async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('✅ Connected to PostgreSQL database');
  } catch (error) {
    logger.error('❌ Failed to connect to database:', error.message);
    throw error;
  }
}

/**
 * Gracefully disconnect from the database.
 */
async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('🔌 Disconnected from PostgreSQL database');
}

module.exports = { prisma, connectDatabase, disconnectDatabase };
