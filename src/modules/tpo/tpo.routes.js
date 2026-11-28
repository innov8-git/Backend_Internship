'use strict';

const { Router } = require('express');
const tpoController = require('./tpo.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

// Strictly private: accessible ONLY to authenticated TPOs (own records) and ADMINs.
// Intentionally excluded from public Swagger documentation.
router.use(authenticate, authorize(ROLES.TPO, ROLES.ADMIN));

router.get('/me/summary', tpoController.getMyTpoSummary);
router.get('/me/referrals', tpoController.listMyTpoReferrals);
router.get('/me/payouts', tpoController.listMyTpoPayouts);

module.exports = router;
