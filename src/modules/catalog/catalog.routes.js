const { Router } = require('express');
const catalogController = require('./catalog.controller');
const { getDomainProjects } = require('../admin/admin-projects.controller');

const router = Router();

router.get('/designations', catalogController.listDesignations);
router.get('/designations/:idOrSlug', catalogController.getDesignation);
router.get('/domains', catalogController.listDomains);
router.get('/domains/:domainId/projects', getDomainProjects);
router.get('/internship-plans', catalogController.listPlans);
router.get('/internship-plans/:id/schedule-preview', catalogController.getSchedulePreview);

module.exports = router;
