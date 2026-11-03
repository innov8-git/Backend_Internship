const { Router } = require('express');
const certificatesController = require('./certificates.controller');
const { authenticate, authorize } = require('../../common/guards');
const { ROLES } = require('../../common/constants');

const router = Router();

router.get('/mine', authenticate, authorize(ROLES.STUDENT), certificatesController.getMyCertificates);
router.get('/:id/download', authenticate, certificatesController.downloadCertificate);
router.get('/:certificateNo/verify', certificatesController.verifyCertificate);

module.exports = router;
