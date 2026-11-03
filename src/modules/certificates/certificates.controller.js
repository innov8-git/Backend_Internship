const PDFDocument = require('pdfkit');
const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const { CERTIFICATE_STATUS, ROLES } = require('../../common/constants');

const DOWNLOAD_TTL_MINUTES = 5;

function certificateDto(certificate) {
  if (!certificate) return null;
  const enrollment = certificate.enrollment;
  const plan = enrollment?.plan;
  const user = certificate.user;

  return {
    _id: certificate.id,
    certificateNo: certificate.certificateNo,
    userId: certificate.userId,
    enrollmentId: certificate.enrollmentId,
    status: certificate.status,
    issuedAt: certificate.issuedAt,
    emailStatus: certificate.emailStatus,
    revokedAt: certificate.revokedAt || null,
    revokeReason: certificate.revokeReason || null,
    studentName: user?.name || null,
    designation: plan?.designation
      ? { _id: plan.designation.id, name: plan.designation.name, slug: plan.designation.slug }
      : null,
    domain: plan?.domain
      ? { _id: plan.domain.id, name: plan.domain.name, slug: plan.domain.slug }
      : null,
    durationMonths: plan?.durationMonths || null,
    verifyUrl: `/certificates/${certificate.certificateNo}/verify`,
  };
}

function generateCertificatePdfBuffer({
  certificateNo,
  studentName,
  designation,
  domain,
  durationMonths,
  issuedAt,
  verifyUrl,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Decorative borders
    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).lineWidth(3).stroke('#2563EB');
    doc.rect(25, 25, doc.page.width - 50, doc.page.height - 50).lineWidth(1).stroke('#93C5FD');

    doc.moveDown(3);
    doc.fontSize(28).fillColor('#1E3A8A').text('CERTIFICATE OF COMPLETION', { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(14).fillColor('#4B5563').text('This is proudly presented to', { align: 'center' });
    doc.moveDown(0.8);
    doc.fontSize(24).fillColor('#111827').text(studentName || 'Student', { align: 'center', underline: true });
    doc.moveDown(0.8);
    doc.fontSize(14).fillColor('#4B5563').text(`for successfully completing the ${durationMonths || 1}-month internship in`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(18).fillColor('#2563EB').text(`${designation || 'Intern'} - ${domain || 'Domain'}`, { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(10).fillColor('#6B7280').text(`Certificate No: ${certificateNo}  |  Issued: ${new Date(issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, { align: 'center' });
    if (verifyUrl) {
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#9CA3AF').text(`Verify online: ${verifyUrl}`, { align: 'center' });
    }

    doc.end();
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const getMyCertificates = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);

  const [total, certs] = await Promise.all([
    prisma.certificate.count({ where: { userId: req.user.id } }),
    prisma.certificate.findMany({
      where: { userId: req.user.id },
      include: {
        user: true,
        enrollment: {
          include: {
            plan: { include: { designation: true, domain: true } },
          },
        },
      },
      orderBy: { issuedAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(certs.map(certificateDto), total, page, limit));
});

const downloadCertificate = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const certificate = await prisma.certificate.findUnique({
    where: { id },
    include: {
      user: true,
      enrollment: {
        include: {
          plan: { include: { designation: true, domain: true } },
        },
      },
    },
  });

  if (!certificate) throw ApiError.notFound('Certificate not found.');

  if (certificate.userId !== req.user.id && !req.user.roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', 'Access denied.');
  }

  if (certificate.status === CERTIFICATE_STATUS.REVOKED) {
    throw ApiError.forbidden(
      'CERTIFICATE_REVOKED',
      'This certificate has been revoked and can no longer be downloaded.',
    );
  }

  const dto = certificateDto(certificate);
  const pdfBuffer = await generateCertificatePdfBuffer({
    certificateNo: dto.certificateNo,
    studentName: dto.studentName,
    designation: dto.designation?.name,
    domain: dto.domain?.name,
    durationMonths: dto.durationMonths,
    issuedAt: dto.issuedAt,
    verifyUrl: dto.verifyUrl,
  });

  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MINUTES * 60 * 1000).toISOString();

  ok(res, { url: dataUrl, expiresAt });
});

const verifyCertificate = asyncHandler(async (req, res) => {
  const certificateNo = decodeURIComponent(req.params.certificateNo).trim().toUpperCase();

  const certificate = await prisma.certificate.findFirst({
    where: {
      certificateNo: { equals: certificateNo, mode: 'insensitive' },
    },
    include: {
      enrollment: {
        include: {
          plan: { include: { designation: true, domain: true } },
        },
      },
    },
  });

  if (!certificate) throw ApiError.notFound('Certificate not found.');

  const plan = certificate.enrollment?.plan;

  // Minimal public verification info (never student contact info)
  ok(res, {
    certificateNo: certificate.certificateNo,
    status: certificate.status,
    designation: plan?.designation?.name || null,
    domain: plan?.domain?.name || null,
    durationMonths: plan?.durationMonths || null,
    issuedAt: certificate.issuedAt,
    revokedAt: certificate.revokedAt,
  });
});

module.exports = {
  getMyCertificates,
  downloadCertificate,
  verifyCertificate,
  certificateDto,
};
