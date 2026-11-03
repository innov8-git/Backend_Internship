const dotenv = require('dotenv');
const path = require('path');

// Load .env before validation
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { validateEnv } = require('./env.validation');
const env = validateEnv();

/**
 * Centralised config object — every module reads from here, never process.env directly.
 */
const config = Object.freeze({
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  server: {
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
  },

  db: {
    url: env.DATABASE_URL,
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },

  bcrypt: {
    saltRounds: env.BCRYPT_SALT_ROUNDS,
  },

  cors: {
    origin: env.CORS_ORIGIN,
  },

  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.EMAIL_FROM,
  },

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
  },

  upload: {
    maxFileSize: env.MAX_FILE_SIZE,
    dir: env.UPLOAD_DIR,
    provider: env.STORAGE_PROVIDER,
  },

  aws: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    bucket: env.AWS_S3_BUCKET,
  },

  gcs: {
    projectId: env.GCS_PROJECT_ID,
    bucket: env.GCS_BUCKET,
    keyFile: env.GCS_KEY_FILE,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    loginWindowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
    loginMax: env.LOGIN_RATE_LIMIT_MAX,
  },

  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: env.GITHUB_CALLBACK_URL,
  },

  logging: {
    level: env.LOG_LEVEL,
    dir: env.LOG_DIR,
  },

  clientUrl: env.CLIENT_URL,
});

module.exports = config;
