const cors = require('cors');
const config = require('./index');

/**
 * CORS configuration.
 * Allows credentials (for httpOnly refresh-token cookie) and the frontend origin.
 */
function createCorsOptions() {
  return cors({
    origin: config.cors.origin.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count'],
    maxAge: 86400, // 24 hours
  });
}

module.exports = { createCorsOptions };
