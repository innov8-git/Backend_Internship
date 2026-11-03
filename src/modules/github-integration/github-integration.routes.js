const { Router } = require('express');
const githubController = require('./github-integration.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

router.use(authenticate, authorize(ROLES.STUDENT));

router.post('/connect', githubController.connectGithub);
router.get('/callback', githubController.callbackGithub);
router.get('/connection', githubController.getConnectionStatus);
router.delete('/connection', githubController.disconnectGithub);

module.exports = router;
