const path = require('path');
const multer = require('multer');
const { ApiError, asyncHandler, ok, created } = require('../../utils');
const { getStorage } = require('../../libs/storage');
const { InternshipsService } = require('./services/internships.service');

const LOGO_UPLOAD_RULES = Object.freeze({
  maxFileSizeBytes: 2 * 1024 * 1024, // 2 MB
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
  allowedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml',
  ],
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LOGO_UPLOAD_RULES.maxFileSizeBytes,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (!LOGO_UPLOAD_RULES.allowedExtensions.includes(ext) || !LOGO_UPLOAD_RULES.allowedMimeTypes.includes(mime)) {
      return cb(ApiError.badRequest('Logo must be a PNG, JPG, WEBP, or SVG image.'));
    }
    cb(null, true);
  },
});

function uploadLogoMiddleware(req, res, next) {
  logoUpload.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest('Logo image must be 2 MB or smaller.'));
      }
      return next(ApiError.badRequest(err.message));
    }
    return next(err);
  });
}

/**
 * GET /api/v1/internships & /api/v1/admin/internships
 * Supports query params: search, track (all | web | app), domain (all | <domain>), page, limit
 */
const listInternships = asyncHandler(async (req, res) => {
  const { search, track, domain, page, limit } = req.query;
  const result = InternshipsService.listPositions({
    search,
    track,
    domain,
    page,
    limit,
  });
  ok(res, result);
});

/**
 * GET /api/v1/internships/quote
 * Computes pricing breakdown by company/internshipId, domain, and duration (1, 2, 3, 6 months).
 */
const getInternshipQuote = asyncHandler(async (req, res) => {
  const { internshipId, companyName, domainName, durationMonths, duration } = req.query;
  const quote = InternshipsService.getQuote({
    internshipId,
    companyName,
    domainName,
    durationMonths: durationMonths ?? duration,
  });
  ok(res, quote);
});

/**
 * GET /api/v1/internships/:id
 */
const getInternshipById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const position = InternshipsService.getPositionById(id);
  ok(res, position);
});

/**
 * POST /api/v1/admin/internships
 */
const createInternship = asyncHandler(async (req, res) => {
  const createdRole = await InternshipsService.savePosition(req.body, null, {
    actorId: req.user?.id,
    ip: req.ip,
  });
  created(res, createdRole);
});

/**
 * PUT /api/v1/admin/internships/:id
 */
const updateInternship = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updatedRole = await InternshipsService.savePosition(req.body, id, {
    actorId: req.user?.id,
    ip: req.ip,
  });
  ok(res, updatedRole);
});

/**
 * DELETE /api/v1/admin/internships/:id
 */
const deleteInternship = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await InternshipsService.deletePosition(id, {
    actorId: req.user?.id,
    ip: req.ip,
  });
  ok(res, result);
});

/**
 * POST /api/v1/admin/internships/reset
 */
const resetInternships = asyncHandler(async (req, res) => {
  const defaults = await InternshipsService.resetToDefaults({
    actorId: req.user?.id,
    ip: req.ip,
  });
  ok(res, { success: true, count: defaults.length, companies: defaults });
});

/**
 * POST /api/v1/admin/internships/logo
 * Uploads a partner company logo image to configured storage and returns its public URL.
 */
const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest('Logo image file is required.');
  }
  const storage = getStorage();
  const uploaded = await storage.upload(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    { folder: 'partner-logos' },
  );
  created(res, {
    logoUrl: uploaded.url,
    storageKey: uploaded.storageKey,
    name: uploaded.name,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
  });
});

module.exports = {
  listInternships,
  getInternshipQuote,
  getInternshipById,
  createInternship,
  updateInternship,
  deleteInternship,
  resetInternships,
  uploadLogoMiddleware,
  uploadLogo,
};
