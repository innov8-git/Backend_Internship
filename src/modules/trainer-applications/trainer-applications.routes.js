'use strict';

const { Router } = require('express');
const { createTrainerApplicationLimiter } = require('../../config/rate-limit.config');
const trainerApplicationsController = require('./trainer-applications.controller');

const router = Router();

// Public trainer join request submission (multipart/form-data with resume file)
router.post(
  '/',
  createTrainerApplicationLimiter(),
  trainerApplicationsController.resumeUploadMiddleware,
  trainerApplicationsController.submitTrainerApplication,
);

module.exports = router;
