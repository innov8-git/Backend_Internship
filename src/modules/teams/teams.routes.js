const { Router } = require('express');
const teamsController = require('./teams.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

// Static routes before parameterized routes
router.get('/mine', authenticate, authorize(ROLES.STUDENT), teamsController.getMyTeams);
router.get('/invites/:token', teamsController.getInviteDetails);
router.post('/invites/:token/accept', authenticate, authorize(ROLES.STUDENT), teamsController.acceptInvite);
router.post('/invites/:token/decline', authenticate, teamsController.declineInvite);

// Team CRUD and team actions
router.post('/', authenticate, authorize(ROLES.STUDENT), teamsController.createTeam);
router.get('/:id', authenticate, teamsController.getTeamById);
router.post('/:id/invites', authenticate, authorize(ROLES.STUDENT), teamsController.inviteMembers);
router.post('/:id/invites/:inviteId/resend', authenticate, authorize(ROLES.STUDENT), teamsController.resendInvite);
router.delete('/:id/invites/:inviteId', authenticate, authorize(ROLES.STUDENT), teamsController.cancelInvite);
router.get('/:id/readiness', authenticate, teamsController.getTeamReadiness);
router.put('/:id/repo', authenticate, authorize(ROLES.STUDENT), teamsController.updateTeamRepo);
router.get('/:id/progress', authenticate, teamsController.getTeamProgress);

module.exports = router;
