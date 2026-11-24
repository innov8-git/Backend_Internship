'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

/**
 * Abstract storage provider interface.
 * Implementations: LocalStorage, CloudinaryStorage, S3Storage, GCSStorage.
 * Active provider is selected by STORAGE_PROVIDER env var ('local' | 'cloudinary' | 's3' | 'gcs').
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
   * Save a file buffer to local disk.
   * @param {Buffer} buffer
   * @param {string} originalName
   * @param {string} mimeType
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
      resourceType: 'local',
    };
  }

  getFilePath(storageKey) {
    const safeKey = path.basename(String(storageKey || ''));
    return path.resolve(this.uploadDir, safeKey);
  }

  async delete(storageKey) {
    const filePath = this.getFilePath(storageKey);
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  getUrl(storageKey) {
    return `/uploads/${storageKey}`;
  }

  getSignedUrl(storageKey, _expiresInSeconds = 300) {
    return `/uploads/${storageKey}`;
  }
}

// ─── Cloudinary Storage ──────────────────────────────────────────────────────

class CloudinaryStorage {
  constructor({ cloudName, apiKey, apiSecret, folder = 'internship-portal' } = {}) {
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        'CloudinaryStorage requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }
    const { v2: cloudinary } = require('cloudinary');
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    this.cloudinary = cloudinary;
    this.folder = folder;
  }

  /**
   * Upload a file buffer directly to Cloudinary via upload_stream.
   * @param {Buffer} buffer
   * @param {string} originalName
   * @param {string} mimeType
   * @returns {Promise<{storageKey: string, url: string, name: string, mimeType: string, sizeBytes: number}>}
   */
  async upload(buffer, originalName, mimeType) {
    const isImage = Boolean(mimeType && mimeType.startsWith('image/'));
    const resourceType = isImage ? 'image' : 'raw';
    const ext = isImage ? '' : path.extname(originalName || '').toLowerCase();
    const publicId = `${uuidv4()}${ext}`;

    const result = await new Promise((resolve, reject) => {
      const uploadStream = this.cloudinary.uploader.upload_stream(
        {
          folder: this.folder,
          public_id: publicId,
          resource_type: resourceType,
          overwrite: false,
        },
        (error, res) => {
          if (error) return reject(error);
          return resolve(res);
        },
      );

      Readable.from(buffer).pipe(uploadStream);
    });

    return {
      storageKey: result.public_id,
      url: result.secure_url,
      name: originalName,
      mimeType,
      sizeBytes: result.bytes || buffer.length,
      resourceType,
    };
  }

  async delete(storageKey, resourceType = 'image') {
    if (!storageKey) return;
    await this.cloudinary.uploader.destroy(storageKey, {
      resource_type: resourceType,
      invalidate: true,
    });
  }

  getUrl(storageKey) {
    return this.cloudinary.url(storageKey, { secure: true });
  }

  getSignedUrl(storageKey, expiresInSeconds = 300) {
    const expiresAt = Math.floor(Date.now() / 1000) + Number(expiresInSeconds || 300);
    return this.cloudinary.url(storageKey, {
      secure: true,
      sign_url: true,
      expires_at: expiresAt,
    });
  }
}

// ─── S3 Storage (placeholder — configure when AWS keys are available) ────────

class S3Storage {
  constructor(_config) {
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

function resetStorage() {
  instance = null;
}

function getStorage() {
  if (instance) return instance;

  const provider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();

  switch (provider) {
    case 'cloudinary':
      instance = new CloudinaryStorage({
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
        folder: process.env.CLOUDINARY_FOLDER || 'internship-portal',
      });
      break;
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

module.exports = {
  getStorage,
  resetStorage,
  LocalStorage,
  CloudinaryStorage,
  S3Storage,
  GCSStorage,
};
