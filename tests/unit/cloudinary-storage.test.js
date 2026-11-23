'use strict';

const { PassThrough } = require('stream');

const mockUploadStream = jest.fn();
const mockDestroy = jest.fn();
const mockUrl = jest.fn();
const mockConfig = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: mockConfig,
    uploader: {
      upload_stream: mockUploadStream,
      destroy: mockDestroy,
    },
    url: mockUrl,
  },
}));

const { CloudinaryStorage, getStorage, resetStorage } = require('../../src/libs/storage');

describe('CloudinaryStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStorage();
  });

  test('throws when required Cloudinary credentials are missing', () => {
    expect(() => new CloudinaryStorage({ cloudName: 'demo' })).toThrow(/CLOUDINARY_CLOUD_NAME/);
  });

  test('streams buffer to Cloudinary and returns normalized upload metadata', async () => {
    mockUploadStream.mockImplementation((opts, cb) => {
      const stream = new PassThrough();
      stream.on('finish', () => {
        cb(null, {
          public_id: `${opts.folder}/${opts.public_id}`,
          secure_url: `https://res.cloudinary.com/demo/image/upload/${opts.folder}/${opts.public_id}.png`,
          bytes: 1234,
        });
      });
      return stream;
    });

    const storage = new CloudinaryStorage({
      cloudName: 'demo',
      apiKey: 'key_123',
      apiSecret: 'sec_456',
      folder: 'internship-portal',
    });

    const result = await storage.upload(Buffer.from('fake-png'), 'screenshot.png', 'image/png');

    expect(mockConfig).toHaveBeenCalledWith({
      cloud_name: 'demo',
      api_key: 'key_123',
      api_secret: 'sec_456',
      secure: true,
    });
    expect(result).toMatchObject({
      name: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 1234,
    });
    expect(result.storageKey).toMatch(/^internship-portal\//);
    expect(result.url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\//);
  });

  test('deletes asset with invalidate=true and generates secure/signed URLs', async () => {
    mockDestroy.mockResolvedValueOnce({ result: 'ok' });
    mockUrl.mockReturnValue('https://res.cloudinary.com/demo/image/upload/v1/internship-portal/abc.png');

    const storage = new CloudinaryStorage({
      cloudName: 'demo',
      apiKey: 'key_123',
      apiSecret: 'sec_456',
    });

    await storage.delete('internship-portal/abc');
    expect(mockDestroy).toHaveBeenCalledWith('internship-portal/abc', {
      resource_type: 'image',
      invalidate: true,
    });

    expect(storage.getUrl('internship-portal/abc')).toContain('https://res.cloudinary.com/');
    expect(storage.getSignedUrl('internship-portal/abc', 600)).toContain('https://res.cloudinary.com/');
    expect(mockUrl).toHaveBeenLastCalledWith(
      'internship-portal/abc',
      expect.objectContaining({ secure: true, sign_url: true, expires_at: expect.any(Number) }),
    );
  });

  test('getStorage() returns CloudinaryStorage when STORAGE_PROVIDER=cloudinary', () => {
    const prev = {
      STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    };

    try {
      process.env.STORAGE_PROVIDER = 'cloudinary';
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key_123';
      process.env.CLOUDINARY_API_SECRET = 'sec_456';

      const storage = getStorage();
      expect(storage).toBeInstanceOf(CloudinaryStorage);
    } finally {
      Object.assign(process.env, prev);
      resetStorage();
    }
  });
});
