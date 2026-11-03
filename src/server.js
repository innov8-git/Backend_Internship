const config = require('./config');
const logger = require('./libs/logger');
const app = require('./app');
const { connectDatabase, disconnectDatabase } = require('./database');
const { connectRedis, disconnectRedis } = require('./libs/cache');

async function startServer() {
  try {
    // Connect to PostgreSQL
    await connectDatabase();

    // Connect to Redis (non-fatal if unavailable)
    await connectRedis();

    // Start HTTP server
    const server = app.listen(config.server.port, () => {
      logger.info(`🚀 Server running on port ${config.server.port} (${config.env})`);
      logger.info(`📡 API: http://localhost:${config.server.port}${config.server.apiPrefix}`);
      logger.info(`❤️  Health: http://localhost:${config.server.port}/health`);
    });

    // ─── Graceful shutdown ──────────────────────────────────────────────────
    const shutdown = async (signal) => {
      logger.info(`\n${signal} received — shutting down gracefully…`);

      server.close(async () => {
        await disconnectDatabase();
        await disconnectRedis();
        logger.info('👋 Server stopped.');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Log unhandled rejections but don't crash
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });
  } catch (err) {
    logger.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
