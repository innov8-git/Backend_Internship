'use strict';

const { prisma } = require('../../database');
const { ApiError, asyncHandler, ok, parsePagination, paginatedResponse } = require('../../utils');
const { notificationDto } = require('./services/notifications.service');

const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 20);
  const unreadOnly = req.query.unreadOnly === 'true';

  const where = {
    userId: req.user.id,
    ...(unreadOnly && { isRead: false }),
  };

  const [total, unreadCount, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const response = paginatedResponse(items.map(notificationDto), total, page, limit);
  response.unreadCount = unreadCount;
  ok(res, response);
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.user.id) {
    throw ApiError.notFound('Notification not found.');
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });

  ok(res, notificationDto(updated));
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  });

  ok(res, { updatedCount: result.count });
});

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
