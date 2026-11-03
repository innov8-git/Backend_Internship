const { prisma } = require('../../database');
const logger = require('../../libs/logger');

async function addAudit({
  actorId,
  action,
  entityType = null,
  entityId = null,
  before = null,
  after = null,
  ip = null,
}) {
  try {
    if (!actorId) {
      logger.warn('addAudit called without actorId:', { action, entityType, entityId });
      return null;
    }
    const log = await prisma.auditLog.create({
      data: {
        actorId,
        action,
        entityType,
        entityId: entityId ? String(entityId) : null,
        before: before !== null && before !== undefined ? JSON.parse(JSON.stringify(before)) : null,
        after: after !== null && after !== undefined ? JSON.parse(JSON.stringify(after)) : null,
        ip: ip || null,
      },
    });
    return log;
  } catch (err) {
    logger.error('Failed to create audit log:', err.message);
    return null;
  }
}

module.exports = { addAudit };
