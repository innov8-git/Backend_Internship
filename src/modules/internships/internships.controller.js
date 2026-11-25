const { asyncHandler, ok, created } = require('../../utils');
const { InternshipsService } = require('./services/internships.service');

/**
 * GET /api/v1/internships & /api/v1/admin/internships
 * Supports query params: search, track (all | web | app), domain (all | <domain>), page, limit
 */
const listInternships = asyncHandler(async (req, res) => {
  const { search, track, domain, page, limit } = req.query;
  const result = InternshipsService.listPositions({
    search,
    track,
    domain,
    page,
    limit,
  });
  ok(res, result);
});

/**
 * GET /api/v1/internships/:id
 */
const getInternshipById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const position = InternshipsService.getPositionById(id);
  ok(res, position);
});

/**
 * POST /api/v1/admin/internships
 */
const createInternship = asyncHandler(async (req, res) => {
  const createdRole = await InternshipsService.savePosition(req.body, null, {
    actorId: req.user?.id,
    ip: req.ip,
  });
  created(res, createdRole);
});

/**
 * PUT /api/v1/admin/internships/:id
 */
const updateInternship = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updatedRole = await InternshipsService.savePosition(req.body, id, {
    actorId: req.user?.id,
    ip: req.ip,
  });
  ok(res, updatedRole);
});

/**
 * DELETE /api/v1/admin/internships/:id
 */
const deleteInternship = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await InternshipsService.deletePosition(id, {
    actorId: req.user?.id,
    ip: req.ip,
  });
  ok(res, result);
});

/**
 * POST /api/v1/admin/internships/reset
 */
const resetInternships = asyncHandler(async (req, res) => {
  const defaults = await InternshipsService.resetToDefaults({
    actorId: req.user?.id,
    ip: req.ip,
  });
  ok(res, { success: true, count: defaults.length, companies: defaults });
});

module.exports = {
  listInternships,
  getInternshipById,
  createInternship,
  updateInternship,
  deleteInternship,
  resetInternships,
};
