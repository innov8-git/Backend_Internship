const { authenticate, authorize, optionalAuth } = require('./jwt-auth.guard');

module.exports = {
  authenticate,
  authorize,
  optionalAuth,
};
