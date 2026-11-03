const { Router } = require('express');
const trainerController = require('./trainer.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

// Trainer only
router.use(authenticate, authorize(ROLES.TRAINER));

router.get('/stats', trainerController.getTrainerStats);
router.get('/assignments', trainerController.getTrainerAssignments);
router.get('/submissions', trainerController.getTrainerSubmissions);
router.get('/submissions/:id', trainerController.getTrainerSubmissionById);
router.post('/submissions/:id/review', trainerController.reviewSubmission);

module.exports = router;
