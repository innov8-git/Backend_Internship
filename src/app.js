const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const hpp = require('hpp');
const path = require('path');

const config = require('./config');
const { createCorsOptions } = require('./config/cors.config');
const { createGlobalLimiter } = require('./config/rate-limit.config');
const { errorHandler, notFoundHandler } = require('./common/filters/error-handler');
const logger = require('./libs/logger');

// ─── Route imports ─────────────────────────────────────────────────────────
const authRoutes = require('./modules/auth/auth.routes');
const catalogRoutes = require('./modules/catalog/catalog.routes');
const assessmentRoutes = require('./modules/assessments/assessments.routes');
const enrollmentRoutes = require('./modules/enrollment/enrollment.routes');
const taskRoutes = require('./modules/tasks/tasks.routes');
const teamRoutes = require('./modules/teams/teams.routes');
const githubRoutes = require('./modules/github-integration/github-integration.routes');
const certificateRoutes = require('./modules/certificates/certificates.routes');
const trainerRoutes = require('./modules/trainer/trainer.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const scheduleRoutes = require('./modules/schedule/schedule.routes');

const app = express();

// ─── Security middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(hpp());

// ─── CORS ───────────────────────────────────────────────────────────────────
app.use(createCorsOptions());

// ─── Request parsing ────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Compression ────────────────────────────────────────────────────────────
app.use(compression());

// ─── HTTP request logging ───────────────────────────────────────────────────
const morganFormat = config.isDev ? 'dev' : 'combined';
app.use(
  morgan(morganFormat, {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (_req, res) => config.isTest || res.statusCode < 400,
  }),
);

// ─── Rate limiting ──────────────────────────────────────────────────────────
if (!config.isTest) {
  app.use(createGlobalLimiter());
}

// ─── Static files (uploaded files for local storage) ────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), 'public/uploads')));

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── API Routes ─────────────────────────────────────────────────────────────
const api = config.server.apiPrefix;

app.use(`${api}/auth`, authRoutes);
app.use(api, catalogRoutes);
app.use(`${api}/assessments`, assessmentRoutes);
app.use(api, enrollmentRoutes);
app.use(api, taskRoutes);
app.use(`${api}/teams`, teamRoutes);
app.use(`${api}/github`, githubRoutes);
app.use(`${api}/certificates`, certificateRoutes);
app.use(`${api}/trainer`, trainerRoutes);
app.use(`${api}/admin`, adminRoutes);
app.use(api, scheduleRoutes);

// ─── 404 catch-all ──────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ─── Global error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

module.exports = app;
