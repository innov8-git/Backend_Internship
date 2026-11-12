'use strict';

const { errorHandler, notFoundHandler } = require('./error-handler');

module.exports = {
  errorHandler,
  notFoundHandler,
  globalExceptionFilter: errorHandler,
};

