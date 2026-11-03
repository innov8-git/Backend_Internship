const { Router } = require('express');
const assessmentsController = require('./assessments.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

// Student only
router.use(authenticate, authorize(ROLES.STUDENT));

router.get('/attempts/mine', assessmentsController.getMyAttempts);
router.get('/:designationId/attempt', assessmentsController.getMyAttemptForDesignation);
router.get('/:designationId', assessmentsController.getAssessment);
router.post('/:designationId/submit', assessmentsController.submitAssessment);

module.exports = router;
