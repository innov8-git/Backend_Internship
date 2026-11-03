const { Router } = require('express');
const tasksController = require('./tasks.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

router.get('/enrollments/:id/tasks', authenticate, authorize(ROLES.STUDENT), tasksController.listEnrollmentTasks);
router.get('/tasks/:id/content', authenticate, tasksController.getTaskContent);
router.post('/tasks/:id/start', authenticate, authorize(ROLES.STUDENT), tasksController.startTask);
router.post(
  '/tasks/:id/submissions',
  authenticate,
  authorize(ROLES.STUDENT),
  tasksController.upload.array('screenshots', 5),
  tasksController.submitTask,
);
router.get('/tasks/:id/submissions', authenticate, tasksController.listTaskSubmissions);

module.exports = router;
