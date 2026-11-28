const { Router } = require('express');
const adminController = require('./admin.controller');
const adminCatalogController = require('./admin-catalog.controller');
const adminProjectsController = require('./admin-projects.controller');
const adminQuestionsController = require('./admin-questions.controller');
const adminTpoController = require('./admin-tpo.controller');
const adminChangeRequestsController = require('./admin-change-requests.controller');
const internshipsController = require('../internships/internships.controller');
const { validateInternshipPayload } = require('../internships/internships.validator');
const trainerApplicationsController = require('../trainer-applications/trainer-applications.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');
const { validate } = require('../../common/pipes');
const {
  createTrainerSchema,
  updateTrainerPrivilegeSchema,
} = require('./dto/admin-trainer.dto');
const {
  createTpoSchema,
  updateTpoSchema,
  provisionTpoPortalSchema,
  recordTpoPayoutSchema,
} = require('./dto/admin-tpo.dto');
const {
  acceptTrainerApplicationSchema,
} = require('../trainer-applications/trainer-applications.dto');

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
router.delete('/designations/:id', adminCatalogController.deleteDesignation);

// ─── Catalog: Domains ────────────────────────────────────────────────────────
router.get('/domains', adminCatalogController.listAdminDomains);
router.post('/domains', adminCatalogController.createDomain);
router.put('/domains/:id', adminCatalogController.updateDomain);
router.patch('/domains/:id/status', adminCatalogController.updateDomainStatus);
router.delete('/domains/:id', adminCatalogController.deleteDomain);
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

// ─── Catalog: Partner Internships ───────────────────────────────────────────
router.get('/internships', internshipsController.listInternships);
router.post('/internships', validateInternshipPayload, internshipsController.createInternship);
router.put('/internships/:id', validateInternshipPayload, internshipsController.updateInternship);
router.delete('/internships/:id', internshipsController.deleteInternship);
router.post('/internships/reset', internshipsController.resetInternships);

// ─── Project Assignments ─────────────────────────────────────────────────────
router.get('/project-assignments', adminProjectsController.listProjectAssignments);
router.post('/project-assignments', adminProjectsController.assignProject);
router.delete('/project-assignments/:enrollmentId', adminProjectsController.unassignProject);


// ─── Catalog: Assessments ────────────────────────────────────────────────────
router.get('/assessments', adminCatalogController.listAdminAssessments);
router.get('/assessments/:designationId', adminCatalogController.getAdminAssessment);
router.put('/assessments/:designationId', adminCatalogController.saveAssessmentDraft);
router.patch('/assessments/:designationId/publish', adminCatalogController.publishAssessment);

// ─── User Management ─────────────────────────────────────────────────────────
router.get('/users', adminController.listUsers);
router.patch('/users/:id/roles', adminController.updateUserRoles);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.patch('/users/:id/trainer', adminController.updateStudentTrainer);
router.delete('/users/:id', adminController.deleteUser);


// ─── Enrollments Monitoring ──────────────────────────────────────────────────
router.get('/enrollments', adminController.listAdminEnrollments);
router.get('/enrollments/:id', adminController.getAdminEnrollmentById);

// ─── Submissions & Escalations Oversight ─────────────────────────────────────
router.get('/submissions', adminController.listAdminSubmissions);
router.post('/submissions/:id/review', adminController.reviewAdminSubmission);

// ─── Revenue Analytics ───────────────────────────────────────────────────────
router.get('/revenue', adminController.getAdminRevenue);

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
router.get('/trainer-assignments/summary', adminController.getTrainerAssignmentsSummary);
router.post('/trainer-assignments', adminController.createTrainerAssignment);
router.delete('/trainer-assignments/:id', adminController.deleteTrainerAssignment);

// ─── Trainers Management ─────────────────────────────────────────────────────
router.get('/trainers', adminController.listTrainers);
router.post('/trainers', validate(createTrainerSchema), adminController.createTrainer);
router.get('/trainers/:id/resume', adminController.getTrainerResume);
router.patch('/trainers/:id', validate(updateTrainerPrivilegeSchema), adminController.updateTrainerStatus);
router.delete('/trainers/:id', adminController.deleteTrainer);
router.get('/trainers/:id/assignments', adminController.listTrainerAssignmentsForTrainer);
router.get('/trainers/:id/reports', adminController.getAdminTrainerReports);
router.post('/trainers/:id/assignments', adminController.assignToTrainer);
router.delete('/trainers/:trainerId/assignments/:assignmentId', adminController.removeTrainerAssignmentForTrainer);

// ─── Trainer Join Requests ───────────────────────────────────────────────────
router.get('/trainer-applications', trainerApplicationsController.listTrainerApplications);
router.get('/trainer-applications/:id/resume', trainerApplicationsController.getTrainerApplicationResume);
router.post(
  '/trainer-applications/:id/accept',
  validate(acceptTrainerApplicationSchema),
  trainerApplicationsController.acceptTrainerApplication,
);
router.delete('/trainer-applications/:id', trainerApplicationsController.deleteTrainerApplication);

// ─── Trainer Change Requests (student-submitted, admin resolves) ──────────────
router.get('/trainer-change-requests', adminChangeRequestsController.listTrainerChangeRequests);
router.patch('/trainer-change-requests/:id', adminChangeRequestsController.resolveTrainerChangeRequest);

// ─── TPOs (Referral Codes, Earnings, Payouts & Private Portal Access) ────────
router.get('/tpos', adminTpoController.listAdminTpos);
router.post('/tpos', validate(createTpoSchema), adminTpoController.createAdminTpo);
router.get('/tpos/:id', adminTpoController.getAdminTpoById);
router.patch('/tpos/:id', validate(updateTpoSchema), adminTpoController.updateAdminTpo);
router.post(
  '/tpos/:id/portal-access',
  validate(provisionTpoPortalSchema),
  adminTpoController.provisionOrResetTpoPortalAccess,
);
router.delete('/tpos/:id', adminTpoController.deleteAdminTpo);
router.get('/tpos/:id/referrals', adminTpoController.listTpoReferrals);
router.get('/tpos/:id/earnings', adminTpoController.getAdminTpoEarnings);
router.post(
  '/tpos/:id/payouts',
  validate(recordTpoPayoutSchema),
  adminTpoController.recordAdminTpoPayout,
);

module.exports = router;
