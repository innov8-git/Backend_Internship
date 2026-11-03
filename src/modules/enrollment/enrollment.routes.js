const { Router } = require('express');
const enrollmentController = require('./enrollment.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

// Terms (public latest version, authenticated accept)
router.get('/terms/latest', enrollmentController.getLatestTerms);
router.post('/terms/accept', authenticate, authorize(ROLES.STUDENT), enrollmentController.acceptTerms);

// Quotes & Enrollments (STUDENT only)
router.post('/enrollments/quote', authenticate, authorize(ROLES.STUDENT), enrollmentController.createQuote);
router.get('/enrollments', authenticate, authorize(ROLES.STUDENT), enrollmentController.listMyEnrollments);
router.post('/enrollments', authenticate, authorize(ROLES.STUDENT), enrollmentController.createEnrollment);
router.get('/enrollments/:id', authenticate, enrollmentController.getEnrollmentById);

// Payments
router.post('/payments/orders', authenticate, authorize(ROLES.STUDENT), enrollmentController.createPaymentOrder);
router.post('/payments/mock/complete', authenticate, enrollmentController.completeMockPayment);
router.post('/payments/webhooks/:provider', enrollmentController.handlePaymentWebhook);

module.exports = router;
