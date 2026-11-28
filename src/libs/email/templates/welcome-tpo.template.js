'use strict';

/**
 * Private welcome email sent to a newly provisioned TPO with their confidential portal credentials.
 * Intentionally avoids any public branding links to keep the TPO flow private.
 */
function getWelcomeTpoEmailTemplate({
  name,
  college,
  referralCode,
  email,
  password,
  loginUrl = 'http://localhost:5173/login',
}) {
  const subject = 'Your Private TPO Partner Access & Reference Code';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TPO Partner Access</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155;">
  <div style="width:100%;padding:36px 0;background-color:#f8fafc;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0f172a 0%,#334155 100%);padding:30px 24px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">TPO Partner Access</h1>
        <p style="margin:6px 0 0;color:#cbd5e1;font-size:14px;">Confidential Referral Tracking Portal</p>
      </div>
      <div style="padding:32px;">
        <p style="font-size:17px;font-weight:600;color:#0f172a;margin:0 0 12px;">Hello ${name},</p>
        <p style="font-size:14.5px;line-height:1.6;color:#475569;margin:0 0 22px;">
          An administrator has activated your private TPO partner access${college ? ` for <strong>${college}</strong>` : ''}.
          Use the credentials below to privately check your student referral count and reference earnings at any time.
        </p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:6px 0;color:#64748b;font-weight:600;width:38%;">Reference Code:</td>
              <td style="padding:6px 0;font-family:'Courier New',monospace;font-weight:700;color:#4f46e5;">${referralCode}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#64748b;font-weight:600;">Login Email:</td>
              <td style="padding:6px 0;color:#0f172a;font-weight:600;">${email}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#64748b;font-weight:600;">Password:</td>
              <td style="padding:6px 0;">
                <span style="display:inline-block;background:#e0e7ff;color:#3730a3;padding:3px 10px;border-radius:6px;font-family:'Courier New',monospace;font-weight:700;">${password}</span>
              </td>
            </tr>
          </table>
        </div>

        <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;font-size:13px;color:#92400e;margin-bottom:24px;">
          <strong>Confidential:</strong> Please share only your Reference Code (<strong>${referralCode}</strong>) with students. Keep your login email and password strictly private.
        </div>

        <div style="text-align:center;margin-bottom:20px;">
          <a href="${loginUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14.5px;font-weight:600;">Sign In to Check Referrals</a>
        </div>
      </div>
      <div style="border-top:1px solid #f1f5f9;padding:18px 24px;font-size:12px;color:#94a3b8;text-align:center;background:#f8fafc;">
        Automated confidential notice. Do not forward this email.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}

module.exports = {
  getWelcomeTpoEmailTemplate,
};
