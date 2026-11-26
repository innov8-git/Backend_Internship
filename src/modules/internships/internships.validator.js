const { ApiError } = require('../../utils');

function validateInternshipPayload(req, _res, next) {
  const { companyName, track } = req.body || {};
  const errors = [];

  if (!companyName || !String(companyName).trim()) {
    errors.push({ field: 'companyName', message: 'Partner company name is required.' });
  }

  if (track && !['web', 'app'].includes(track)) {
    errors.push({ field: 'track', message: 'Track must be either "web" or "app".' });
  }

  if (errors.length > 0) {
    return next(ApiError.validationError(errors));
  }

  next();
}

module.exports = {
  validateInternshipPayload,
};
