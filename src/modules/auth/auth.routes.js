const { Router } = require('express');
const authController = require('./auth.controller');
const { authenticate } = require('../../common/guards');
const { createLoginLimiter } = require('../../config/rate-limit.config');

const router = Router();

router.post('/register', authController.register);
router.post('/login', createLoginLimiter(), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);
router.patch('/me', authenticate, authController.updateMe);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
