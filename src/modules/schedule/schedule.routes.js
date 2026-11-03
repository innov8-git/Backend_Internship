const { Router } = require('express');
const scheduleController = require('./schedule.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

// Student routes (mounted at /api/v1)
router.get('/enrollments/:id/schedule', authenticate, scheduleController.getStudentSchedule);
router.get('/enrollments/:id/schedule/days/:dayNumber/sop', authenticate, scheduleController.getDaySop);

// Admin schedule template routes (mounted at /api/v1)
router.get('/admin/schedules', authenticate, authorize(ROLES.ADMIN), scheduleController.listAdminSchedules);
router.post('/admin/schedules', authenticate, authorize(ROLES.ADMIN), scheduleController.createAdminSchedule);
router.get('/admin/schedules/:id', authenticate, authorize(ROLES.ADMIN), scheduleController.getAdminScheduleById);
router.put('/admin/schedules/:id', authenticate, authorize(ROLES.ADMIN), scheduleController.updateAdminSchedule);
router.patch('/admin/schedules/:id/publish', authenticate, authorize(ROLES.ADMIN), scheduleController.publishAdminSchedule);
router.get('/admin/schedules/:id/versions', authenticate, authorize(ROLES.ADMIN), scheduleController.listScheduleVersions);
router.post('/admin/schedules/:id/clone', authenticate, authorize(ROLES.ADMIN), scheduleController.cloneAdminSchedule);
router.get('/admin/schedules/:id/tasks', authenticate, authorize(ROLES.ADMIN), scheduleController.listScheduleTasks);
router.patch('/admin/schedules/:id/tasks/reorder', authenticate, authorize(ROLES.ADMIN), scheduleController.reorderScheduleTasks);

// Admin task definition routes
router.post('/admin/tasks', authenticate, authorize(ROLES.ADMIN), scheduleController.createTaskDefinition);
router.put('/admin/tasks/:id', authenticate, authorize(ROLES.ADMIN), scheduleController.updateTaskDefinition);
router.delete('/admin/tasks/:id', authenticate, authorize(ROLES.ADMIN), scheduleController.deleteTaskDefinition);

module.exports = router;
