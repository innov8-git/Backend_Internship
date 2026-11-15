'use strict';

/**
 * Generate responsive HTML email for welcoming newly created trainers with login credentials.
 *
 * @param {object} options
 * @param {string} options.name - Trainer full name
 * @param {string} options.email - Trainer login email
 * @param {string} options.password - Initial / system-generated password
 * @param {string} [options.loginUrl] - Direct URL to login page
 * @returns {{ subject: string, html: string }}
 */
function getWelcomeTrainerEmailTemplate({ name, email, password, loginUrl = 'http://localhost:5173/login' }) {
  const subject = 'Welcome to ALFRE — Your Trainer Account Credentials';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ALFRE</title>
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
      max-width: 560px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      padding: 36px 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      color: #ffffff;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 8px 0 0;
      color: #e0e7ff;
      font-size: 15px;
    }
    .content {
      padding: 36px 32px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 12px;
    }
    .message {
      font-size: 15px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
    }
    .creds-card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 20px 24px;
      margin-bottom: 24px;
    }
    .creds-row {
      display: flex;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .creds-row:last-child {
      margin-bottom: 0;
    }
    .creds-label {
      width: 140px;
      font-weight: 600;
      color: #64748b;
    }
    .creds-value {
      font-family: 'Courier New', Courier, monospace;
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      word-break: break-all;
    }
    .password-badge {
      display: inline-block;
      background-color: #e0e7ff;
      color: #4338ca;
      padding: 4px 10px;
      border-radius: 6px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .notice-box {
      background-color: #fffbeb;
      border-left: 4px solid #f59e0b;
      padding: 14px 18px;
      border-radius: 4px;
      font-size: 13.5px;
      color: #92400e;
      line-height: 1.5;
      margin-bottom: 28px;
    }
    .button-wrapper {
      text-align: center;
      margin-bottom: 28px;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      box-shadow: 0 4px 10px rgba(79, 70, 229, 0.3);
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
        <h1>Welcome to ALFRE</h1>
        <p>Internship & Mentorship Portal</p>
      </div>
      <div class="content">
        <p class="greeting">Hello ${name},</p>
        <p class="message">
          We are thrilled to welcome you to the ALFRE team! An administrator has set up your Trainer account. You can now log in to the portal to review student progress, guide project groups, and manage your mentorship sessions.
        </p>

        <div class="creds-card">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600; width: 35%;">Login Email:</td>
              <td style="padding: 6px 0; color: #1e293b; font-weight: 600;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Password:</td>
              <td style="padding: 6px 0;">
                <span class="password-badge">${password}</span>
              </td>
            </tr>
          </table>
        </div>

        <div class="notice-box">
          ⚠️ <strong>NOTE:</strong> This password is system generated. Please log in and reset your password immediately from your profile settings for security.
        </div>

        <div class="button-wrapper">
          <a href="${loginUrl}" class="btn" target="_blank" rel="noopener noreferrer">Log In to Your Trainer Portal</a>
        </div>

        <p class="message" style="font-size: 13.5px; color: #64748b; margin-bottom: 0;">
          If the button above does not work, copy and paste this link into your browser:<br>
          <a href="${loginUrl}" style="color: #4f46e5; word-break: break-all;">${loginUrl}</a>
        </p>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} ALFRE Internship Portal. All rights reserved.<br>
        This is an automated system message containing sensitive login details. Please do not forward or share this email.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}

module.exports = {
  getWelcomeTrainerEmailTemplate,
};

