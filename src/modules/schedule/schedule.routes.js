const { Router } = require('express');
const scheduleController = require('./schedule.controller');
const { authenticate } = require('../../common/guards');

const router = Router();

// Student routes (mounted at /api/v1)
router.get('/enrollments/:id/schedule', authenticate, scheduleController.getStudentSchedule);
router.get('/enrollments/:id/schedule/days/:dayNumber/sop', authenticate, scheduleController.getDaySop);


module.exports = router;
