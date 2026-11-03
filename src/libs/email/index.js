const nodemailer = require('nodemailer');
const config = require('../../config');
const logger = require('../logger');
const { prisma } = require('../../database');

let transporter = null;

/**
 * Get or create the Nodemailer transporter.
 */
function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  return transporter;
}

/**
 * Send an email and log it to the email_jobs table.
 * @param {object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @param {string} [options.template] - Template name (for logging)
 * @param {string} [options.link] - Link included in email (for logging)
 * @param {object} [options.payload] - Additional payload (for logging)
 * @returns {Promise<object>} EmailJob record
 */
async function sendEmail({ to, subject, html, template = 'generic', link = null, payload = null }) {
  // Create the email job record first
  const job = await prisma.emailJob.create({
    data: {
      to,
      template,
      subject,
      link,
      payload,
      status: 'PENDING',
    },
  });

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: config.email.from,
      to,
      subject,
      html,
    });

    // Update job status to SENT
    await prisma.emailJob.update({
      where: { id: job.id },
      data: { status: 'SENT', sentAt: new Date() },
    });

    logger.info(`📧 Email sent to ${to}: ${subject}`);
    return { ...job, status: 'SENT', sentAt: new Date() };
  } catch (err) {
    // Update job status to FAILED
    await prisma.emailJob.update({
      where: { id: job.id },
      data: { status: 'FAILED' },
    });

    logger.error(`📧 Email failed to ${to}: ${err.message}`);
    return { ...job, status: 'FAILED' };
  }
}

/**
 * Send a verification email.
 */
async function sendVerificationEmail(email, name, token) {
  const verifyUrl = `${config.clientUrl}/verify-email?token=${token}`;
  const html = `
    <h2>Welcome to the Internship Portal, ${name}!</h2>
    <p>Please verify your email address by clicking the link below:</p>
    <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:8px;">Verify Email</a></p>
    <p>This link will expire in 24 hours.</p>
    <p>If you didn't create an account, you can safely ignore this email.</p>
  `;
  return sendEmail({
    to: email,
    subject: 'Verify your email — Internship Portal',
    html,
    template: 'email-verification',
    link: verifyUrl,
    payload: { name },
  });
}

/**
 * Send a password reset email.
 */
async function sendPasswordResetEmail(email, name, token) {
  const resetUrl = `${config.clientUrl}/reset-password?token=${token}`;
  const html = `
    <h2>Password Reset</h2>
    <p>Hi ${name}, you requested a password reset.</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:8px;">Reset Password</a></p>
    <p>This link will expire in 1 hour. If you didn't request this, ignore this email.</p>
  `;
  return sendEmail({
    to: email,
    subject: 'Reset your password — Internship Portal',
    html,
    template: 'password-reset',
    link: resetUrl,
    payload: { name },
  });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  getTransporter,
};
