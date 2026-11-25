'use strict';

const { prisma } = require('../../../database');
const { ROLES, USER_STATUS } = require('../../../common/constants');
const logger = require('../../../libs/logger');

function notificationDto(item) {
  if (!item) return null;
  return {
    _id: item.id,
    userId: item.userId,
    type: item.type,
    title: item.title,
    message: item.message,
    link: item.link || null,
    isRead: Boolean(item.isRead),
    metadata: item.metadata || null,
    createdAt: item.createdAt,
  };
}

/**
 * Create a single in-app notification. Safe/non-throwing so core workflows never fail
 * because of a notification error.
 */
async function createNotification({ userId, type, title, message, link = null, metadata = null }) {
  if (!userId || !title) return null;
  try {
    const created = await prisma.notification.create({
      data: {
        userId,
        type: type || 'INFO',
        title,
        message: message || '',
        link,
        metadata,
      },
    });
    return notificationDto(created);
  } catch (err) {
    logger.warn(`[Notifications] Failed to create notification for user ${userId}: ${err.message}`);
    return null;
  }
}

/**
 * Create the same notification for multiple users.
 */
async function createNotificationsForUsers(userIds, payload) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  try {
    await prisma.notification.createMany({
      data: uniqueIds.map((userId) => ({
        userId,
        type: payload.type || 'INFO',
        title: payload.title,
        message: payload.message || '',
        link: payload.link || null,
        metadata: payload.metadata || null,
      })),
    });
    return uniqueIds;
  } catch (err) {
    logger.warn(`[Notifications] Failed to broadcast notification: ${err.message}`);
    return [];
  }
}

/**
 * Notify all active administrators.
 */
async function notifyAdmins(payload) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        status: USER_STATUS.ACTIVE,
        userRoles: {
          some: {
            role: { name: ROLES.ADMIN },
          },
        },
      },
      select: { id: true },
    });
    if (admins.length === 0) return [];
    return createNotificationsForUsers(
      admins.map((a) => a.id),
      payload,
    );
  } catch (err) {
    logger.warn(`[Notifications] Failed to notify admins: ${err.message}`);
    return [];
  }
}

module.exports = {
  notificationDto,
  createNotification,
  createNotificationsForUsers,
  notifyAdmins,
};
