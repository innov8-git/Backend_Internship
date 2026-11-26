const { Router } = require('express');
const internshipsController = require('./internships.controller');
const { validateInternshipPayload } = require('./internships.validator');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

// ─── Public Endpoints (Home page & Student Portal) ───────────────────────────
router.get('/', internshipsController.listInternships);
router.get('/quote', internshipsController.getInternshipQuote);
router.get('/:id', internshipsController.getInternshipById);

// ─── Admin Endpoints (Partner Internships Management) ────────────────────────
router.post(
  '/logo',
  authenticate,
  authorize(ROLES.ADMIN),
  internshipsController.uploadLogoMiddleware,
  internshipsController.uploadLogo,
);

router.post(
  '/',
  authenticate,
  authorize(ROLES.ADMIN),
  validateInternshipPayload,
  internshipsController.createInternship,
);

router.put(
  '/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  validateInternshipPayload,
  internshipsController.updateInternship,
);

router.delete(
  '/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  internshipsController.deleteInternship,
);

router.post(
  '/reset',
  authenticate,
  authorize(ROLES.ADMIN),
  internshipsController.resetInternships,
);

module.exports = router;
