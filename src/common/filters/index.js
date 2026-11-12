'use strict';

const { errorHandler, notFoundHandler } = require('./error-handler');
const { globalExceptionFilter } = require('./global-exception.filter');

module.exports = {
  errorHandler,
  notFoundHandler,
  globalExceptionFilter,
};

