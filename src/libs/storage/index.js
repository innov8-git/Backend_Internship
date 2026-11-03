const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

/**
 * Abstract storage provider interface.
 * Implementations: LocalStorage, S3Storage, GCSStorage.
 * The active provider is selected by STORAGE_PROVIDER env var.
 */

// ─── Local file storage ─────────────────────────────────────────────────────

class LocalStorage {
  constructor(uploadDir) {
    this.uploadDir = uploadDir || './public/uploads';
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Save a file buffer or stream to local disk.
   * @param {Buffer} buffer - file content
   * @param {string} originalName - original filename
   * @param {string} mimeType - MIME type
   * @returns {Promise<{storageKey: string, url: string, name: string, mimeType: string, sizeBytes: number}>}
   */
  async upload(buffer, originalName, mimeType) {
    const ext = path.extname(originalName) || '.bin';
    const key = `${uuidv4()}${ext}`;
    const filePath = path.join(this.uploadDir, key);

    await fs.promises.writeFile(filePath, buffer);

    return {
      storageKey: key,
      url: `/uploads/${key}`,
      name: originalName,
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  /**
   * Delete a file by storage key.
   */
  async delete(storageKey) {
    const filePath = path.join(this.uploadDir, storageKey);
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /**
   * Generate a URL for the file (for local, just the relative path).
   */
  getUrl(storageKey) {
    return `/uploads/${storageKey}`;
  }

  /**
   * Generate a pre-signed URL (for local, returns the same URL — no expiry).
   */
  getSignedUrl(storageKey, _expiresInSeconds = 300) {
    return `/uploads/${storageKey}`;
  }
}

// ─── S3 Storage (placeholder — configure when AWS keys are available) ────────

class S3Storage {
  constructor(_config) {
    // Placeholder: will be implemented when AWS SDK is configured
    logger.info('S3Storage initialized (placeholder — implement with @aws-sdk/client-s3)');
  }

  async upload(_buffer, _originalName, _mimeType) {
    throw new Error('S3Storage.upload() not yet implemented. Add @aws-sdk/client-s3.');
  }

  async delete(_storageKey) {
    throw new Error('S3Storage.delete() not yet implemented.');
  }

  getUrl(_storageKey) {
    throw new Error('S3Storage.getUrl() not yet implemented.');
  }

  getSignedUrl(_storageKey, _expiresInSeconds) {
    throw new Error('S3Storage.getSignedUrl() not yet implemented.');
  }
}

// ─── GCS Storage (placeholder) ───────────────────────────────────────────────

class GCSStorage {
  constructor(_config) {
    logger.info('GCSStorage initialized (placeholder — implement with @google-cloud/storage)');
  }

  async upload(_buffer, _originalName, _mimeType) {
    throw new Error('GCSStorage.upload() not yet implemented. Add @google-cloud/storage.');
  }

  async delete(_storageKey) {
    throw new Error('GCSStorage.delete() not yet implemented.');
  }

  getUrl(_storageKey) {
    throw new Error('GCSStorage.getUrl() not yet implemented.');
  }

  getSignedUrl(_storageKey, _expiresInSeconds) {
    throw new Error('GCSStorage.getSignedUrl() not yet implemented.');
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let instance = null;

function getStorage() {
  if (instance) return instance;

  const provider = process.env.STORAGE_PROVIDER || 'local';

  switch (provider) {
    case 's3':
      instance = new S3Storage({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
        bucket: process.env.AWS_S3_BUCKET,
      });
      break;
    case 'gcs':
      instance = new GCSStorage({
        projectId: process.env.GCS_PROJECT_ID,
        bucket: process.env.GCS_BUCKET,
        keyFile: process.env.GCS_KEY_FILE,
      });
      break;
    case 'local':
    default:
      instance = new LocalStorage(process.env.UPLOAD_DIR);
      break;
  }

  logger.info(`📦 Storage provider: ${provider}`);
  return instance;
}

module.exports = { getStorage, LocalStorage, S3Storage, GCSStorage };
