const Joi = require('joi');

/**
 * Environment variables validation schema (Joi).
 * Validates and provides defaults for all config values at startup.
 */
const envSchema = Joi.object({
  // Server
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(5000),
  API_PREFIX: Joi.string().default('/api/v1'),

  // Database
  DATABASE_URL: Joi.string().required().description('PostgreSQL connection URL'),

  // JWT
  JWT_SECRET: Joi.string().required().min(16),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().required().min(16),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Bcrypt
  BCRYPT_SALT_ROUNDS: Joi.number().default(12),

  // CORS
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  // Email
  SMTP_HOST: Joi.string().default('smtp.gmail.com'),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  EMAIL_FROM: Joi.string().default('Internship Portal <noreply@example.com>'),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // File upload
  MAX_FILE_SIZE: Joi.number().default(5242880), // 5 MB
  UPLOAD_DIR: Joi.string().default('./public/uploads'),
  STORAGE_PROVIDER: Joi.string().valid('local', 's3', 'gcs').default('local'),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  AWS_REGION: Joi.string().default('ap-south-1'),
  AWS_S3_BUCKET: Joi.string().allow('').default(''),
  GCS_PROJECT_ID: Joi.string().allow('').default(''),
  GCS_BUCKET: Joi.string().allow('').default(''),
  GCS_KEY_FILE: Joi.string().allow('').default(''),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000), // 15 min
  RATE_LIMIT_MAX: Joi.number().default(100),
  LOGIN_RATE_LIMIT_WINDOW_MS: Joi.number().default(60000), // 1 min
  LOGIN_RATE_LIMIT_MAX: Joi.number().default(5),

  // GitHub
  GITHUB_CLIENT_ID: Joi.string().allow('').default(''),
  GITHUB_CLIENT_SECRET: Joi.string().allow('').default(''),
  GITHUB_CALLBACK_URL: Joi.string().default('http://localhost:5173/github/callback'),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('debug'),
  LOG_DIR: Joi.string().default('./logs'),

  // Client URL
  CLIENT_URL: Joi.string().default('http://localhost:5173'),
}).unknown(true); // allow other env vars

function validateEnv() {
  const { error, value } = envSchema.validate(process.env, {
    abortEarly: false,
    stripUnknown: false,
  });
  if (error) {
    const messages = error.details.map((d) => `  - ${d.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }
  return value;
}

module.exports = { validateEnv };
