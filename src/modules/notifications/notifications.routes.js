'use strict';

const { Router } = require('express');
const notificationsController = require('./notifications.controller');
const { authenticate } = require('../../common/guards');

const router = Router();

router.use(authenticate);

router.get('/', notificationsController.listNotifications);
router.patch('/read-all', notificationsController.markAllNotificationsRead);
router.patch('/:id/read', notificationsController.markNotificationRead);

module.exports = router;
