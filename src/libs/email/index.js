const nodemailer = require('nodemailer');
const config = require('../../config');
const logger = require('../logger');
const { prisma } = require('../../database');
const { getOtpEmailTemplate } = require('./templates/otp.template');
const { getWelcomeTrainerEmailTemplate } = require('./templates/welcome-trainer.template');
const { getWelcomeTpoEmailTemplate } = require('./templates/welcome-tpo.template');

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
 * Send an OTP code email.
 * @param {object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.otp - 6-digit numeric OTP
 * @param {string} options.purpose - OTP Purpose ('REGISTRATION_VERIFY', 'LOGIN', 'PASSWORD_RESET')
 * @param {string} [options.name] - User's name
 */
async function sendOtpEmail({ to, otp, purpose, name = 'there' }) {
  const { subject, html } = getOtpEmailTemplate({ otp, purpose, name });
  return sendEmail({
    to,
    subject,
    html,
    template: `otp-${purpose.toLowerCase()}`,
    payload: { otp: '******', purpose },
  });
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

/**
 * Send a welcome email to a newly created trainer with their login credentials.
 * @param {object} options
 * @param {string} options.to - Trainer email
 * @param {string} options.name - Trainer full name
 * @param {string} options.email - Trainer login email
 * @param {string} options.password - Plain-text password
 * @param {string} [options.loginUrl] - Client login URL
 */
async function sendTrainerWelcomeEmail({ to, name, email, password, loginUrl }) {
  const resolvedLoginUrl = loginUrl || `${config.clientUrl || 'http://localhost:5173'}/login`;
  const { subject, html } = getWelcomeTrainerEmailTemplate({
    name,
    email,
    password,
    loginUrl: resolvedLoginUrl,
  });

  return sendEmail({
    to,
    subject,
    html,
    template: 'welcome-trainer',
    link: resolvedLoginUrl,
    payload: { name, email },
  });
}

async function sendTpoWelcomeEmail({ to, name, college, referralCode, email, password, loginUrl }) {
  const resolvedLoginUrl = loginUrl || `${config.clientUrl || 'http://localhost:5173'}/login`;
  const { subject, html } = getWelcomeTpoEmailTemplate({
    name,
    college,
    referralCode,
    email,
    password,
    loginUrl: resolvedLoginUrl,
  });

  return sendEmail({
    to,
    subject,
    html,
    template: 'welcome-tpo',
    link: resolvedLoginUrl,
    payload: { name, email, referralCode },
  });
}

async function sendPaymentSuccessEmail(to, name, enrollmentId, amountFormatted) {
  const dashboardUrl = `${config.clientUrl || 'http://localhost:5173'}/dashboard`;
  const html = `
    <h2>Payment Confirmed — Welcome, ${name || 'Student'}!</h2>
    <p>Your payment of <strong>₹${amountFormatted}</strong> has been confirmed and your internship enrollment is now active.</p>
    <p>An administrator will allocate your domain capstone project and assigned mentor shortly.</p>
    <p><a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:8px;">Open Dashboard</a></p>
  `;
  return sendEmail({
    to,
    subject: 'Payment confirmed — Internship Portal',
    html,
    template: 'payment-success',
    link: dashboardUrl,
    payload: { enrollmentId, amountFormatted },
  });
}

async function sendCertificateIssuedEmail(to, name, certificateNo, designationName) {
  const verifyUrl = `${config.clientUrl || 'http://localhost:5173'}/verify/${encodeURIComponent(certificateNo)}`;
  const html = `
    <h2>Congratulations, ${name || 'Graduate'}!</h2>
    <p>You have successfully completed your <strong>${designationName || 'Internship'}</strong> program.</p>
    <p>Your verifiable certificate number is <strong>${certificateNo}</strong>.</p>
    <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#10B981;color:white;text-decoration:none;border-radius:8px;">Verify Certificate</a></p>
  `;
  return sendEmail({
    to,
    subject: `Your Internship Certificate (${certificateNo}) is Ready`,
    html,
    template: 'certificate-issued',
    link: verifyUrl,
    payload: { certificateNo, designationName },
  });
}

async function sendTeamInviteEmail(to, leaderName, teamName, token) {
  const inviteUrl = `${config.clientUrl || 'http://localhost:5173'}/team/invite/${encodeURIComponent(token)}`;
  const html = `
    <h2>You're invited to join team ${teamName}!</h2>
    <p><strong>${leaderName || 'A teammate'}</strong> invited you to collaborate on their internship team.</p>
    <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:8px;">View Invitation</a></p>
  `;
  return sendEmail({
    to,
    subject: `Team invite: Join ${teamName}`,
    html,
    template: 'team-invite',
    link: inviteUrl,
    payload: { teamName, leaderName },
  });
}

async function sendProjectAssignedEmail({ to, name, projectTitle, domainName, track, taskCount }) {
  const tasksUrl = `${config.clientUrl || 'http://localhost:5173'}/tasks`;
  const html = `
    <h2>Your Capstone Project & Tasks Are Ready!</h2>
    <p>Hi ${name || 'Student'}, an administrator has assigned you the <strong>${projectTitle}</strong> project (${domainName || 'Domain'} · ${track === 'app' ? 'Mobile App' : 'Web Development'} track).</p>
    <p>${taskCount} structured task${taskCount === 1 ? '' : 's'} have been unlocked on your task board and schedule.</p>
    <p><a href="${tasksUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:8px;">View Your Tasks</a></p>
  `;
  return sendEmail({
    to,
    subject: `Project Assigned: ${projectTitle}`,
    html,
    template: 'project-assigned',
    link: tasksUrl,
    payload: { projectTitle, domainName, track, taskCount },
  });
}

async function sendTaskSubmittedEmail({ to, trainerName, studentName, taskTitle, submissionId }) {
  const reviewUrl = `${config.clientUrl || 'http://localhost:5173'}/trainer/review/${encodeURIComponent(submissionId)}`;
  const html = `
    <h2>New Submission Waiting for Review</h2>
    <p>Hi ${trainerName || 'Trainer'}, <strong>${studentName || 'a student'}</strong> submitted work for <strong>${taskTitle || 'a task'}</strong>.</p>
    <p><a href="${reviewUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:8px;">Review Submission</a></p>
  `;
  return sendEmail({
    to,
    subject: `New Submission: ${taskTitle || 'Task'} — ${studentName || 'Student'}`,
    html,
    template: 'task-submitted',
    link: reviewUrl,
    payload: { submissionId, studentName, taskTitle },
  });
}

async function sendTaskReviewedEmail({ to, studentName, taskTitle, decision, feedback, taskProgressId }) {
  const taskUrl = `${config.clientUrl || 'http://localhost:5173'}/tasks/${encodeURIComponent(taskProgressId)}?tab=history`;
  const labels = {
    APPROVED: 'Approved',
    CHANGES_REQUESTED: 'Changes Requested',
    REJECTED: 'Rejected',
    ESCALATED: 'Escalated for Lead Review',
  };
  const label = labels[decision] || decision;
  const html = `
    <h2>Task Review Update: ${label}</h2>
    <p>Hi ${studentName || 'Student'}, your submission for <strong>${taskTitle || 'your task'}</strong> was marked <strong>${label}</strong>.</p>
    ${feedback ? `<blockquote style="border-left:3px solid #cbd5e1;padding-left:12px;color:#334155;">${feedback}</blockquote>` : ''}
    <p><a href="${taskUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:8px;">View Task & Feedback</a></p>
  `;
  return sendEmail({
    to,
    subject: `Task ${label}: ${taskTitle || 'Your submission'}`,
    html,
    template: 'task-reviewed',
    link: taskUrl,
    payload: { taskProgressId, decision },
  });
}

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTrainerWelcomeEmail,
  sendTpoWelcomeEmail,
  sendPaymentSuccessEmail,
  sendCertificateIssuedEmail,
  sendTeamInviteEmail,
  sendProjectAssignedEmail,
  sendTaskSubmittedEmail,
  sendTaskReviewedEmail,
  getTransporter,
};
