'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  buildOrderBy,
  paginatedResponse,
  hashPassword,
} = require('../../utils');
const {
  ROLES,
  TRAINER_APPLICATION_STATUS,
} = require('../../common/constants');
const { getStorage, LocalStorage } = require('../../libs/storage');
const { addAudit } = require('../audit-log/audit-log.service');
const { sendTrainerWelcomeEmail } = require('../../libs/email');
const { invalidateAuthUserCache } = require('../../common/guards');
const logger = require('../../libs/logger');
const { submitTrainerApplicationSchema } = require('./trainer-applications.dto');

const RESUME_RULES = Object.freeze({
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  allowedExtensions: ['.pdf', '.doc', '.docx'],
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream', // fallback when browser omits specific office MIME; verified via extension + magic bytes
  ],
  extToMime: {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: RESUME_RULES.maxFileSizeBytes,
    files: 1,
  },
});

/**
 * Multer middleware wrapper converting upload limits into structured 422 validation errors.
 */
function resumeUploadMiddleware(req, res, next) {
  upload.single('resume')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          ApiError.validationError([
            { field: 'resume', message: 'Resume file must be 5 MB or smaller.' },
          ]),
        );
      }
      return next(
        ApiError.validationError([
          { field: 'resume', message: err.message || 'Invalid resume upload.' },
        ]),
      );
    }
    return next(err);
  });
}

/**
 * Verify file signature (magic bytes) so renamed executables/HTML cannot bypass extension checks.
 */
function hasValidResumeSignature(buffer, ext) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (ext === '.pdf') {
    // %PDF
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }
  if (ext === '.docx') {
    // ZIP container: PK\x03\x04
    return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  if (ext === '.doc') {
    // OLE2 Compound Document: D0 CF 11 E0
    return buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  }
  return false;
}

function validateResumeFile(file) {
  if (!file) {
    return { field: 'resume', message: 'Please upload your resume (PDF, DOC, or DOCX, max 5 MB).' };
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!RESUME_RULES.allowedExtensions.includes(ext)) {
    return { field: 'resume', message: 'Only PDF, DOC, and DOCX files are allowed.' };
  }
  if (file.mimetype && !RESUME_RULES.allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
    return { field: 'resume', message: 'Unsupported resume file type. Upload a PDF, DOC, or DOCX.' };
  }
  if (file.size > RESUME_RULES.maxFileSizeBytes) {
    return { field: 'resume', message: 'Resume file must be 5 MB or smaller.' };
  }
  if (!hasValidResumeSignature(file.buffer, ext)) {
    return {
      field: 'resume',
      message: 'The uploaded file appears corrupted or does not match its file extension.',
    };
  }
  return null;
}

function applicationDto(app, existingUserMap = null) {
  const existingUser = existingUserMap ? existingUserMap.get(app.email.toLowerCase()) || null : null;
  return {
    _id: app.id,
    id: app.id,
    fullName: app.fullName,
    email: app.email,
    phone: app.phone,
    linkedinUrl: app.linkedinUrl,
    organization: app.organization,
    domain: app.domain,
    experience: app.experience,
    bio: app.bio,
    resumeUrl: app.resumeUrl,
    resumeName: app.resumeName,
    resumeMimeType: app.resumeMimeType,
    resumeSize: app.resumeSize,
    status: app.status,
    reviewedById: app.reviewedById,
    reviewedAt: app.reviewedAt,
    createdUserId: app.createdUserId,
    existingUser: existingUser
      ? {
          _id: existingUser.id,
          name: existingUser.name,
          status: existingUser.status,
          roles: (existingUser.userRoles || []).map((ur) => ur.role?.name).filter(Boolean),
        }
      : null,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

/**
 * Securely stream a stored resume (either local disk or remote Cloudinary URL) to an admin response.
 */
async function streamResumeFile(res, { resumeUrl, resumeKey, resumeName, resumeMimeType }, { download = false } = {}) {
  if (!resumeUrl && !resumeKey) {
    throw ApiError.notFound('No resume file found for this record.');
  }

  const safeName = String(resumeName || 'Resume.pdf').replace(/["\r\n\\]/g, '_');
  const mimeType = resumeMimeType || 'application/pdf';
  const disposition = download ? 'attachment' : 'inline';

  const storage = getStorage();

  // Case 1: Local storage file
  if (storage instanceof LocalStorage || (resumeUrl && resumeUrl.startsWith('/uploads/'))) {
    const key = resumeKey || path.basename(resumeUrl || '');
    const filePath =
      typeof storage.getFilePath === 'function'
        ? storage.getFilePath(key)
        : path.resolve(process.env.UPLOAD_DIR || './public/uploads', path.basename(key));

    if (!fs.existsSync(filePath)) {
      throw ApiError.notFound('Resume file is no longer available on the server.');
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(filePath);
  }

  // Case 2: Remote URL (e.g. Cloudinary)
  if (resumeUrl && /^https?:\/\//i.test(resumeUrl)) {
    const upstream = await fetch(resumeUrl);
    if (!upstream.ok) {
      throw ApiError.notFound('Resume file could not be retrieved from storage.');
    }
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  }

  throw ApiError.notFound('Resume file location is invalid.');
}

// ─── Public Endpoint ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/trainer-applications (public, multipart/form-data)
 */
const submitTrainerApplication = asyncHandler(async (req, res) => {
  // Anti-spam honeypot: silently succeed without storing if a bot fills the hidden `website` field
  if (req.body?.website && String(req.body.website).trim() !== '') {
    return created(
      res,
      { _id: crypto.randomUUID(), status: TRAINER_APPLICATION_STATUS.PENDING },
      'Your trainer application has been submitted successfully.',
    );
  }

  const { error, value } = submitTrainerApplicationSchema.validate(req.body || {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  const details = [];
  if (error) {
    for (const d of error.details) {
      details.push({ field: d.path.join('.'), message: d.message.replace(/"/g, '') });
    }
  }

  const fileError = validateResumeFile(req.file);
  if (fileError) {
    details.push(fileError);
  }

  if (details.length > 0) {
    throw ApiError.validationError(details);
  }

  const normalizedEmail = value.email.toLowerCase().trim();

  // Prevent duplicate pending requests for the same email
  const existingPending = await prisma.trainerApplication.findFirst({
    where: {
      email: normalizedEmail,
      status: TRAINER_APPLICATION_STATUS.PENDING,
    },
  });

  if (existingPending) {
    throw ApiError.conflict(
      'APPLICATION_ALREADY_PENDING',
      'An application with this email is already pending review. Our team will get back to you soon.',
      [{ field: 'email', message: 'A trainer join request with this email is already under review.' }],
    );
  }

  // Check if user is already an active approved trainer
  const existingTrainer = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: {
      userRoles: { include: { role: true } },
      trainerProfile: true,
    },
  });

  if (
    existingTrainer &&
    existingTrainer.userRoles.some((ur) => ur.role?.name === ROLES.TRAINER) &&
    existingTrainer.trainerProfile?.isApproved !== false
  ) {
    throw ApiError.conflict(
      'ALREADY_A_TRAINER',
      'This email is already registered as an active trainer. Please log in instead.',
      [{ field: 'email', message: 'This email is already an active trainer account.' }],
    );
  }

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const effectiveMime = RESUME_RULES.extToMime[ext] || req.file.mimetype || 'application/pdf';

  const storage = getStorage();
  const uploaded = await storage.upload(req.file.buffer, req.file.originalname, effectiveMime);

  let application;
  try {
    application = await prisma.trainerApplication.create({
      data: {
        fullName: value.fullName.trim(),
        email: normalizedEmail,
        phone: value.phone.trim(),
        linkedinUrl: value.linkedinUrl.trim(),
        organization: value.organization.trim(),
        domain: value.domain.trim(),
        experience: value.experience.trim(),
        bio: value.bio ? value.bio.trim() : null,
        resumeUrl: uploaded.url,
        resumeKey: uploaded.storageKey,
        resumeName: uploaded.name,
        resumeMimeType: effectiveMime,
        resumeSize: uploaded.sizeBytes,
        status: TRAINER_APPLICATION_STATUS.PENDING,
      },
    });
  } catch (dbErr) {
    // Roll back uploaded file if DB insert fails
    try {
      await storage.delete(uploaded.storageKey, uploaded.resourceType || 'raw');
    } catch (cleanupErr) {
      logger.warn(`Failed to clean up orphaned resume ${uploaded.storageKey}: ${cleanupErr.message}`);
    }
    throw dbErr;
  }

  created(
    res,
    {
      _id: application.id,
      fullName: application.fullName,
      email: application.email,
      domain: application.domain,
      organization: application.organization,
      resumeName: application.resumeName,
      status: application.status,
      submittedAt: application.createdAt,
    },
    'Your trainer application has been submitted successfully! Our admin team will review your details and email your login credentials once approved.',
  );
});

// ─── Admin Endpoints ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/trainer-applications
 * Defaults to PENDING so accepted requests disappear from "Join Requests".
 */
const listTrainerApplications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, status = TRAINER_APPLICATION_STATUS.PENDING, sort } = req.query;

  const statusFilter =
    status && String(status).toUpperCase() !== 'ALL'
      ? { status: String(status).toUpperCase() }
      : {};

  const where = {
    ...statusFilter,
    ...(search && {
      OR: [
        { fullName: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { phone: { contains: String(search), mode: 'insensitive' } },
        { organization: { contains: String(search), mode: 'insensitive' } },
        { domain: { contains: String(search), mode: 'insensitive' } },
      ],
    }),
  };

  const orderBy = buildOrderBy(sort, 'createdAt:desc', [
    'createdAt',
    'fullName',
    'email',
    'organization',
    'domain',
  ]);

  const [total, pendingCount, items] = await Promise.all([
    prisma.trainerApplication.count({ where }),
    prisma.trainerApplication.count({ where: { status: TRAINER_APPLICATION_STATUS.PENDING } }),
    prisma.trainerApplication.findMany({
      where,
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  // Batch lookup whether any applicant emails already exist in users table
  const emails = [...new Set(items.map((a) => a.email.toLowerCase()))];
  const existingUsers =
    emails.length > 0
      ? await prisma.user.findMany({
          where: { email: { in: emails } },
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            userRoles: { select: { role: { select: { name: true } } } },
          },
        })
      : [];

  const existingUserMap = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

  ok(res, {
    ...paginatedResponse(
      items.map((a) => applicationDto(a, existingUserMap)),
      total,
      page,
      limit,
    ),
    pendingCount,
  });
});

/**
 * GET /api/v1/admin/trainer-applications/:id/resume
 */
const getTrainerApplicationResume = asyncHandler(async (req, res) => {
  const application = await prisma.trainerApplication.findUnique({
    where: { id: req.params.id },
  });

  if (!application) {
    throw ApiError.notFound('Trainer join request not found.');
  }

  const download = req.query.download === '1' || req.query.download === 'true';
  await streamResumeFile(res, application, { download });
});

/**
 * POST /api/v1/admin/trainer-applications/:id/accept
 * Approves a pending request, provisions trainer account (or upgrades existing user),
 * writes an audit entry, and optionally emails credentials.
 */
const acceptTrainerApplication = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    password,
    sendEmail = true,
    domain,
    experience,
    organization,
    bio,
    upgradeExistingUser = false,
  } = req.body || {};

  const application = await prisma.trainerApplication.findUnique({ where: { id } });
  if (!application) {
    throw ApiError.notFound('Trainer join request not found.');
  }

  if (application.status === TRAINER_APPLICATION_STATUS.APPROVED) {
    throw ApiError.conflict('APPLICATION_ALREADY_APPROVED', 'This trainer request has already been accepted.');
  }

  const normalizedEmail = application.email.toLowerCase().trim();
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: {
      userRoles: { include: { role: true } },
      trainerProfile: true,
    },
  });

  if (existingUser && !upgradeExistingUser) {
    throw ApiError.conflict(
      'EXISTING_USER_ACCOUNT',
      'An account with this email already exists. Confirm upgrading this account to Trainer.',
      [{ field: 'email', message: 'An existing user account was found for this email.' }],
    );
  }

  const trainerRole = await prisma.roleModel.findUnique({ where: { name: ROLES.TRAINER } });
  if (!trainerRole) {
    throw ApiError.internal('System role "TRAINER" is not configured.');
  }

  const customPassword = password && String(password).trim() ? String(password).trim() : null;
  const rawPassword = existingUser
    ? customPassword // for existing user, only change password if admin explicitly enters one
    : customPassword || `${crypto.randomBytes(5).toString('hex')}A1!`;

  const passwordHash = rawPassword ? await hashPassword(rawPassword) : null;

  const finalDomain = (domain && String(domain).trim()) || application.domain;
  const finalExperience = (experience && String(experience).trim()) || application.experience;
  const finalOrg = (organization && String(organization).trim()) || application.organization;
  const finalBio = bio !== undefined ? (bio ? String(bio).trim() : null) : application.bio;

  const result = await prisma.$transaction(async (tx) => {
    let user;
    let profile;

    if (existingUser) {
      user = await tx.user.update({
        where: { id: existingUser.id },
        data: {
          status: 'ACTIVE',
          emailVerified: true,
          ...(passwordHash && { passwordHash }),
          ...(!existingUser.phone && application.phone && { phone: application.phone }),
          ...(!existingUser.organization && finalOrg && { organization: finalOrg }),
          ...(!existingUser.linkedinUrl && application.linkedinUrl && { linkedinUrl: application.linkedinUrl }),
        },
      });

      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: trainerRole.id } },
        create: { userId: user.id, roleId: trainerRole.id },
        update: {},
      });

      profile = await tx.trainerProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          domain: finalDomain,
          experience: finalExperience,
          organization: finalOrg,
          linkedinUrl: application.linkedinUrl,
          resumeUrl: application.resumeUrl,
          resumeKey: application.resumeKey,
          resumeName: application.resumeName,
          resumeMimeType: application.resumeMimeType,
          resumeSize: application.resumeSize,
          bio: finalBio,
          isApproved: true,
        },
        update: {
          domain: finalDomain,
          experience: finalExperience,
          organization: finalOrg,
          linkedinUrl: application.linkedinUrl,
          resumeUrl: application.resumeUrl,
          resumeKey: application.resumeKey,
          resumeName: application.resumeName,
          resumeMimeType: application.resumeMimeType,
          resumeSize: application.resumeSize,
          bio: finalBio,
          isApproved: true,
        },
      });
    } else {
      user = await tx.user.create({
        data: {
          name: application.fullName,
          email: normalizedEmail,
          phone: application.phone,
          organization: finalOrg,
          linkedinUrl: application.linkedinUrl,
          bio: finalBio,
          passwordHash,
          status: 'ACTIVE',
          emailVerified: true,
        },
      });

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: trainerRole.id,
        },
      });

      profile = await tx.trainerProfile.create({
        data: {
          userId: user.id,
          domain: finalDomain,
          experience: finalExperience,
          organization: finalOrg,
          linkedinUrl: application.linkedinUrl,
          resumeUrl: application.resumeUrl,
          resumeKey: application.resumeKey,
          resumeName: application.resumeName,
          resumeMimeType: application.resumeMimeType,
          resumeSize: application.resumeSize,
          bio: finalBio,
          isApproved: true,
        },
      });
    }

    const updatedApp = await tx.trainerApplication.update({
      where: { id: application.id },
      data: {
        status: TRAINER_APPLICATION_STATUS.APPROVED,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        createdUserId: user.id,
      },
    });

    return { user, profile, application: updatedApp };
  });

  if (existingUser) {
    invalidateAuthUserCache(result.user.id);
  }

  await addAudit({
    actorId: req.user.id,
    action: 'TRAINER_APPLICATION_ACCEPTED',
    entityType: 'TrainerApplication',
    entityId: application.id,
    before: {
      status: TRAINER_APPLICATION_STATUS.PENDING,
      fullName: application.fullName,
      email: application.email,
      organization: application.organization,
      domain: application.domain,
    },
    after: {
      status: TRAINER_APPLICATION_STATUS.APPROVED,
      trainerUserId: result.user.id,
      email: result.user.email,
      domain: finalDomain,
      experience: finalExperience,
      organization: finalOrg,
      upgradedExistingUser: Boolean(existingUser),
      emailSent: Boolean(sendEmail && rawPassword),
    },
    ip: req.ip,
  });

  const shouldEmail = Boolean(sendEmail && rawPassword);
  if (shouldEmail) {
    sendTrainerWelcomeEmail({
      to: result.user.email,
      name: result.user.name,
      email: result.user.email,
      password: rawPassword,
    }).catch((err) => {
      logger.error(
        `[Admin] Failed to dispatch welcome email to trainer ${result.user.email}: ${err.message}`,
      );
    });
  }

  ok(
    res,
    {
      trainer: {
        _id: result.user.id,
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        phone: result.user.phone,
        status: result.user.status,
        isTrainer: true,
        trainerProfile: result.profile,
      },
      application: applicationDto(result.application),
      credentials: {
        email: result.user.email,
        password: rawPassword,
        upgradedExistingUser: Boolean(existingUser),
        passwordUpdated: Boolean(rawPassword),
        emailSent: shouldEmail,
      },
    },
    existingUser
      ? 'Trainer request accepted and existing user granted Trainer privileges.'
      : 'Trainer request accepted and trainer account created.',
  );
});

/**
 * DELETE /api/v1/admin/trainer-applications/:id
 * Permanently deletes a join request and cleans up its uploaded resume file.
 */
const deleteTrainerApplication = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const application = await prisma.trainerApplication.findUnique({ where: { id } });
  if (!application) {
    throw ApiError.notFound('Trainer join request not found.');
  }

  const beforeSnapshot = {
    fullName: application.fullName,
    email: application.email,
    phone: application.phone,
    organization: application.organization,
    domain: application.domain,
    experience: application.experience,
    resumeName: application.resumeName,
    status: application.status,
  };

  await prisma.trainerApplication.delete({ where: { id } });

  // Only remove resume from storage if it wasn't transferred to an approved TrainerProfile
  if (application.status === TRAINER_APPLICATION_STATUS.PENDING && application.resumeKey) {
    try {
      const storage = getStorage();
      await storage.delete(application.resumeKey, 'raw');
    } catch (err) {
      logger.warn(`Failed to delete resume file ${application.resumeKey}: ${err.message}`);
    }
  }

  await addAudit({
    actorId: req.user.id,
    action: 'TRAINER_APPLICATION_DELETED',
    entityType: 'TrainerApplication',
    entityId: id,
    before: beforeSnapshot,
    after: null,
    ip: req.ip,
  });

  ok(res, { _id: id, deleted: true }, 'Trainer join request deleted successfully.');
});

module.exports = {
  RESUME_RULES,
  resumeUploadMiddleware,
  streamResumeFile,
  submitTrainerApplication,
  listTrainerApplications,
  getTrainerApplicationResume,
  acceptTrainerApplication,
  deleteTrainerApplication,
};
