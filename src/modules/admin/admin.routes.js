const { Router } = require('express');
const adminController = require('./admin.controller');
const adminCatalogController = require('./admin-catalog.controller');
const adminProjectsController = require('./admin-projects.controller');
const adminQuestionsController = require('./admin-questions.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');
const { validate } = require('../../common/pipes');
const {
  createTrainerSchema,
  updateTrainerPrivilegeSchema,
} = require('./dto/admin-trainer.dto');

const router = Router();

// All admin routes require authentication and ADMIN role
router.use(authenticate, authorize(ROLES.ADMIN));

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
router.get('/stats', adminController.getAdminStats);

// ─── Catalog: Designations ───────────────────────────────────────────────────
router.get('/designations', adminCatalogController.listAdminDesignations);
router.post('/designations', adminCatalogController.createDesignation);
router.put('/designations/:id', adminCatalogController.updateDesignation);
router.patch('/designations/:id/status', adminCatalogController.updateDesignationStatus);

// ─── Catalog: Domains ────────────────────────────────────────────────────────
router.get('/domains', adminCatalogController.listAdminDomains);
router.post('/domains', adminCatalogController.createDomain);
router.put('/domains/:id', adminCatalogController.updateDomain);
router.patch('/domains/:id/status', adminCatalogController.updateDomainStatus);
router.get('/domains/:domainId/questions', adminQuestionsController.listDomainQuestions);
router.post('/domains/:domainId/questions', adminQuestionsController.createDomainQuestion);
router.put('/domains/:domainId/questions/:questionId', adminQuestionsController.updateDomainQuestion);
router.delete('/domains/:domainId/questions/:questionId', adminQuestionsController.deleteDomainQuestion);

// ─── Catalog: Projects ───────────────────────────────────────────────────────
router.get('/projects', adminProjectsController.listAdminProjects);
router.post('/projects', adminProjectsController.createProject);
router.get('/projects/:id', adminProjectsController.getAdminProject);
router.put('/projects/:id', adminProjectsController.updateProject);
router.patch('/projects/:id/status', adminProjectsController.updateProjectStatus);
router.delete('/projects/:id', adminProjectsController.deleteProject);

// ─── Project Assignments ─────────────────────────────────────────────────────
router.get('/project-assignments', adminProjectsController.listProjectAssignments);
router.post('/project-assignments', adminProjectsController.assignProject);
router.delete('/project-assignments/:enrollmentId', adminProjectsController.unassignProject);

// ─── Catalog: Internship Plans ───────────────────────────────────────────────
router.get('/internship-plans', adminCatalogController.listAdminPlans);
router.post('/internship-plans', adminCatalogController.createPlan);
router.put('/internship-plans/:id', adminCatalogController.updatePlan);
router.patch('/internship-plans/:id/status', adminCatalogController.updatePlanStatus);

// ─── Catalog: Assessments ────────────────────────────────────────────────────
router.get('/assessments', adminCatalogController.listAdminAssessments);
router.get('/assessments/:designationId', adminCatalogController.getAdminAssessment);
router.put('/assessments/:designationId', adminCatalogController.saveAssessmentDraft);
router.patch('/assessments/:designationId/publish', adminCatalogController.publishAssessment);

// ─── User Management ─────────────────────────────────────────────────────────
router.get('/users', adminController.listUsers);
router.patch('/users/:id/roles', adminController.updateUserRoles);
router.patch('/users/:id/status', adminController.updateUserStatus);

// ─── Enrollments ─────────────────────────────────────────────────────────────
router.get('/enrollments', adminController.listAdminEnrollments);
router.get('/enrollments/:id', adminController.getAdminEnrollmentById);

// ─── Payments ────────────────────────────────────────────────────────────────
router.get('/payments', adminController.listAdminPayments);
router.get('/payments/:id', adminController.getAdminPaymentById);

// ─── Certificates ────────────────────────────────────────────────────────────
router.get('/certificates', adminController.listAdminCertificates);
router.post('/certificates/:id/resend', adminController.resendCertificateEmail);

// ─── Audit Logs ──────────────────────────────────────────────────────────────
router.get('/audit-logs', adminController.listAdminAuditLogs);

// ─── Teams Lookup ────────────────────────────────────────────────────────────
router.get('/teams', adminController.listAdminTeams);

// ─── Trainer Assignments ─────────────────────────────────────────────────────
router.get('/trainer-assignments', adminController.listTrainerAssignments);
router.post('/trainer-assignments', adminController.createTrainerAssignment);
router.delete('/trainer-assignments/:id', adminController.deleteTrainerAssignment);

// ─── Trainers Management ─────────────────────────────────────────────────────
router.get('/trainers', adminController.listTrainers);
router.post('/trainers', validate(createTrainerSchema), adminController.createTrainer);
router.patch('/trainers/:id', validate(updateTrainerPrivilegeSchema), adminController.updateTrainerStatus);

module.exports = router;
