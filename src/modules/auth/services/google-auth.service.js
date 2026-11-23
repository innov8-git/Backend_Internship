'use strict';

const config = require('../../../config');
const { ApiError } = require('../../../utils');
const logger = require('../../../libs/logger');

let OAuth2Client;
try {
  ({ OAuth2Client } = require('google-auth-library'));
} catch {
  OAuth2Client = null;
}

let client = null;
function getClient() {
  if (!OAuth2Client) {
    throw ApiError.internal('Google sign-in is not available: google-auth-library is not installed.');
  }
  if (!config.google.clientId) {
    throw ApiError.unprocessable('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on the server.');
  }
  if (!client) {
    client = new OAuth2Client(
      config.google.clientId,
      config.google.clientSecret || undefined,
      // GIS popup "code" flow uses the special 'postmessage' redirect URI.
      'postmessage',
    );
  }
  return client;
}

const invalid = () =>
  ApiError.unauthorized('INVALID_GOOGLE_TOKEN', 'Invalid Google credential token or authorization code.');

/**
 * Verifies a Google ID token (credential) or exchanges an auth code, and returns
 * the verified identity: { sub, email, name, picture }.
 */
async function verify({ credential, code } = {}) {
  const oauth = getClient();
  let idToken = credential;

  if (!idToken && code) {
    if (!config.google.clientSecret) {
      throw ApiError.unprocessable('GOOGLE_CODE_FLOW_DISABLED', 'Google code sign-in is not configured on the server.');
    }
    try {
      const { tokens } = await oauth.getToken(code);
      idToken = tokens.id_token;
    } catch (err) {
      logger.warn(`[GoogleAuth] Code exchange failed: ${err.message}`);
      throw invalid();
    }
  }
  if (!idToken) throw invalid();

  let payload;
  try {
    const ticket = await oauth.verifyIdToken({ idToken, audience: config.google.clientId });
    payload = ticket.getPayload();
  } catch (err) {
    logger.warn(`[GoogleAuth] ID token verification failed: ${err.message}`);
    throw invalid();
  }

  if (!payload?.email || payload.email_verified !== true) {
    throw ApiError.unauthorized('GOOGLE_EMAIL_UNVERIFIED', 'Your Google account email is not verified.');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}

module.exports = { verify };
