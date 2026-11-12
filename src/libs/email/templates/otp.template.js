/**
 * Generate responsive HTML email for 6-digit OTP codes.
 *
 * @param {object} options
 * @param {string} options.otp - 6-digit numeric OTP
 * @param {string} options.purpose - OTP Purpose ('REGISTRATION_VERIFY', 'LOGIN', 'PASSWORD_RESET')
 * @param {string} [options.name] - Optional user name
 * @returns {{ subject: string, html: string }}
 */
function getOtpEmailTemplate({ otp, purpose, name = 'there' }) {
  let title = 'Verification Code';
  let subject = 'Your Verification Code — Internship Portal';
  let message = 'Use the 6-digit code below to verify your email address.';

  if (purpose === 'LOGIN') {
    title = 'Login Code';
    subject = 'Your One-Time Login Code — Internship Portal';
    message = 'Use the 6-digit code below to securely sign in to your Internship Portal account.';
  } else if (purpose === 'PASSWORD_RESET') {
    title = 'Password Reset Code';
    subject = 'Your Password Reset Code — Internship Portal';
    message = 'Use the 6-digit code below to reset your account password.';
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #334155;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #f8fafc;
      padding: 40px 0;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      padding: 32px 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      color: #ffffff;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 36px 32px;
    }
    .greeting {
      font-size: 16px;
      color: #1e293b;
      margin-bottom: 12px;
    }
    .message {
      font-size: 15px;
      line-height: 1.6;
      color: #64748b;
      margin-bottom: 28px;
    }
    .otp-box {
      background-color: #f1f5f9;
      border: 2px dashed #cbd5e1;
      border-radius: 10px;
      padding: 20px;
      text-align: center;
      margin-bottom: 28px;
    }
    .otp-code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 10px;
      color: #4f46e5;
      display: inline-block;
      user-select: all;
    }
    .warning {
      background-color: #fffbeb;
      border-left: 4px solid #f59e0b;
      padding: 12px 16px;
      border-radius: 4px;
      font-size: 13px;
      color: #92400e;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .footer {
      border-top: 1px solid #f1f5f9;
      padding: 24px 32px;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
      background-color: #f8fafc;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Internship Portal</h1>
      </div>
      <div class="content">
        <p class="greeting">Hello ${name},</p>
        <p class="message">${message}</p>
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
        </div>
        <div class="warning">
          ⏱️ <strong>This code expires in 5 minutes.</strong><br>
          If you did not make this request, you can safely ignore this email. Never share this code with anyone.
        </div>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} Internship Portal (ALFRE). All rights reserved.<br>
        This is an automated system email, please do not reply.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}

module.exports = {
  getOtpEmailTemplate,
};
