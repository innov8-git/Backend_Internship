const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  noContent,
  generateRandomToken,
} = require('../../utils');
const {
  ROLES,
  TEAM_STATUS,
  MEMBER_STATUS,
  PUBLISH_STATUS,
  TASK_STATUS,
  PAYMENT_STATUS,
  ENROLLMENT_STATUS,
} = require('../../common/constants');
const { sendTeamInviteEmail } = require('../../libs/email');
const logger = require('../../libs/logger');

const TEAM_NAME_MIN = 3;
const TEAM_NAME_MAX = 60;
const MAX_INVITES_PER_REQUEST = 4;
const MAX_TEAM_SIZE = 5;
const MIN_TEAM_SIZE = 2;
const INVITE_EXPIRY_DAYS = 7;
const GITHUB_REPO_URL_RE =
  /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+\/?$/;
const OPEN_STATUSES = [TEAM_STATUS.FORMING, TEAM_STATUS.READY];

function teamMemberDto(member) {
  if (!member) return null;
  return {
    _id: member.id,
    teamId: member.teamId,
    userId: member.userId || null,
    name: member.user?.name || member.name || null,
    email: member.email,
    status: member.status,
    isLeader: Boolean(member.isLeader),
    invitedAt: member.invitedAt || null,
    joinedAt: member.joinedAt || null,
    inviteExpiresAt: member.inviteExpiresAt || null,
  };
}

function teamDto(team) {
  if (!team) return null;
  return {
    _id: team.id,
    name: team.name,
    leaderId: team.leaderId,
    leader: team.leader
      ? { _id: team.leader.id, name: team.leader.name, email: team.leader.email }
      : null,
    planId: team.planId,
    plan: team.plan
      ? {
          _id: team.plan.id,
          durationMonths: team.plan.durationMonths,
          basePrice: team.plan.basePrice,
          currency: team.plan.currency || 'INR',
          designation: team.plan.designation
            ? { _id: team.plan.designation.id, name: team.plan.designation.name, slug: team.plan.designation.slug }
            : null,
          domain: team.plan.domain
            ? { _id: team.plan.domain.id, name: team.plan.domain.name, slug: team.plan.domain.slug }
            : null,
        }
      : null,
    repoUrl: team.repoUrl || null,
    status: team.status,
    members: (team.members || []).map(teamMemberDto),
    createdAt: team.createdAt || null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function checkTeamAccess(teamId, user, { leaderOnly = false, joinedOnly = false } = {}) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      leader: true,
      plan: { include: { designation: true, domain: true } },
      members: { include: { user: true }, orderBy: [{ isLeader: 'desc' }, { invitedAt: 'asc' }] },
    },
  });

  if (!team) throw ApiError.notFound('Team not found.');

  if (leaderOnly) {
    if (team.leaderId !== user.id && !user.roles.includes(ROLES.ADMIN)) {
      throw ApiError.forbidden('FORBIDDEN', 'Only the team leader can do this.');
    }
    return team;
  }

  const isLeader = team.leaderId === user.id;
  const member = team.members.find(
    (m) =>
      (m.userId === user.id || m.email.toLowerCase() === user.email.toLowerCase()) &&
      [MEMBER_STATUS.JOINED, ...(joinedOnly ? [] : [MEMBER_STATUS.INVITED])].includes(m.status),
  );

  const allowed = isLeader || Boolean(member) || user.roles.includes(ROLES.ADMIN);
  if (!allowed) {
    throw ApiError.forbidden('FORBIDDEN', "You're not a member of this team.");
  }

  return team;
}

async function computeTeamReadiness(team) {
  const members = team.members.filter((m) => m.status !== MEMBER_STATUS.DECLINED);
  const plan = team.plan || (await prisma.internshipPlan.findUnique({ where: { id: team.planId } }));

  const memberAssessments = await prisma.assessmentAttempt.findMany({
    where: {
      userId: { in: members.map((m) => m.userId).filter(Boolean) },
      designationId: plan.designationId,
    },
  });
  const assessedUserIds = new Set(memberAssessments.map((a) => a.userId));

  const memberPayments = await prisma.payment.findMany({
    where: {
      enrollment: { teamId: team.id },
      status: PAYMENT_STATUS.SUCCESS,
      flagged: false,
    },
    select: { userId: true },
  });
  const paidUserIds = new Set(memberPayments.map((p) => p.userId));

  const memberStatusList = members.map((m) => {
    const isJoined = m.status === MEMBER_STATUS.JOINED;
    const isAssessed = m.userId ? assessedUserIds.has(m.userId) : false;
    const isPaid = m.userId ? paidUserIds.has(m.userId) : false;

    return {
      memberId: m.id,
      userId: m.userId || null,
      name: m.user?.name || m.name || null,
      email: m.email,
      isLeader: Boolean(m.isLeader),
      status: m.status,
      joined: isJoined,
      assessed: isAssessed,
      paid: isPaid,
    };
  });

  const ready =
    memberStatusList.length >= MIN_TEAM_SIZE &&
    memberStatusList.every((m) => m.joined && m.assessed && m.paid);

  return {
    teamId: team.id,
    status: team.status,
    ready,
    members: memberStatusList,
  };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const getMyTeams = asyncHandler(async (req, res) => {
  const memberships = await prisma.teamMember.findMany({
    where: {
      userId: req.user.id,
      status: MEMBER_STATUS.JOINED,
    },
    select: { teamId: true },
  });
  const joinedTeamIds = memberships.map((m) => m.teamId);

  const teams = await prisma.team.findMany({
    where: {
      OR: [{ leaderId: req.user.id }, { id: { in: joinedTeamIds } }],
    },
    include: {
      leader: true,
      plan: { include: { designation: true, domain: true } },
      members: { include: { user: true }, orderBy: [{ isLeader: 'desc' }, { invitedAt: 'asc' }] },
    },
    orderBy: { createdAt: 'desc' },
  });

  const items = teams.map(teamDto);
  ok(res, { items, page: 1, limit: items.length, total: items.length });
});

const getInviteDetails = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const member = await prisma.teamMember.findUnique({
    where: { inviteToken: token },
    include: {
      team: {
        include: {
          leader: true,
          plan: { include: { designation: true, domain: true } },
          members: { include: { user: true } },
        },
      },
    },
  });

  if (!member) throw ApiError.notFound('Invite not found.');

  ok(res, {
    inviteToken: member.inviteToken,
    email: member.email,
    status: member.status,
    invitedAt: member.invitedAt,
    expiresAt: member.inviteExpiresAt,
    team: teamDto(member.team),
  });
});

const acceptInvite = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const member = await prisma.teamMember.findUnique({
    where: { inviteToken: token },
    include: { team: true },
  });

  if (!member) throw ApiError.notFound('Invite not found.');
  if (member.status !== MEMBER_STATUS.INVITED) {
    throw ApiError.conflict('INVALID_TRANSITION', 'This invite has already been responded to.');
  }

  if (member.inviteExpiresAt && new Date() > member.inviteExpiresAt) {
    throw ApiError.gone('INVITE_EXPIRED', 'This invite link has expired. Ask the leader to resend it.');
  }

  // Update member to JOINED
  await prisma.teamMember.update({
    where: { id: member.id },
    data: {
      userId: req.user.id,
      name: req.user.name,
      status: MEMBER_STATUS.JOINED,
      joinedAt: new Date(),
    },
  });

  const team = await checkTeamAccess(member.teamId, req.user);
  ok(res, teamDto(team));
});

const declineInvite = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const member = await prisma.teamMember.findUnique({
    where: { inviteToken: token },
  });

  if (!member) throw ApiError.notFound('Invite not found.');
  if (member.status !== MEMBER_STATUS.INVITED) {
    throw ApiError.conflict('INVALID_TRANSITION', 'This invite has already been responded to.');
  }

  await prisma.teamMember.update({
    where: { id: member.id },
    data: { status: MEMBER_STATUS.DECLINED },
  });

  ok(res, { message: 'You declined the invite.' });
});

const createTeam = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const planId = String(req.body.planId || '').trim();

  const details = [];
  if (name.length < TEAM_NAME_MIN || name.length > TEAM_NAME_MAX) {
    details.push({
      field: 'name',
      message: `Team name must be ${TEAM_NAME_MIN} to ${TEAM_NAME_MAX} characters.`,
    });
  }

  const plan = planId
    ? await prisma.internshipPlan.findUnique({
        where: { id: planId },
        include: { designation: true, domain: true },
      })
    : null;

  if (!plan || plan.status !== PUBLISH_STATUS.PUBLISHED) {
    details.push({ field: 'planId', message: 'Choose a published internship plan.' });
  }

  if (details.length > 0) throw ApiError.validationError(details);

  const team = await prisma.$transaction(async (tx) => {
    const t = await tx.team.create({
      data: {
        name,
        leaderId: req.user.id,
        planId: plan.id,
        status: TEAM_STATUS.FORMING,
      },
    });

    await tx.teamMember.create({
      data: {
        teamId: t.id,
        userId: req.user.id,
        email: req.user.email,
        name: req.user.name,
        status: MEMBER_STATUS.JOINED,
        isLeader: true,
        joinedAt: new Date(),
      },
    });

    return tx.team.findUnique({
      where: { id: t.id },
      include: {
        leader: true,
        plan: { include: { designation: true, domain: true } },
        members: { include: { user: true } },
      },
    });
  });

  created(res, teamDto(team));
});

const getTeamById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const team = await checkTeamAccess(id, req.user);
  ok(res, teamDto(team));
});

const inviteMembers = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const team = await checkTeamAccess(id, req.user, { leaderOnly: true });

  if (!OPEN_STATUSES.includes(team.status)) {
    throw ApiError.conflict('INVALID_TRANSITION', 'This team can no longer change its members.');
  }

  const emails = Array.isArray(req.body.emails)
    ? [...new Set(req.body.emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
    : [];

  const details = [];
  if (emails.length === 0) {
    details.push({ field: 'emails', message: 'Add at least one email address.' });
  } else if (emails.length > MAX_INVITES_PER_REQUEST) {
    details.push({
      field: 'emails',
      message: `You can invite up to ${MAX_INVITES_PER_REQUEST} people.`,
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid = emails.find((e) => !emailRegex.test(e));
  if (invalid) {
    details.push({ field: 'emails', message: `${invalid} is not a valid email address.` });
  }

  if (emails.some((e) => e === req.user.email.toLowerCase())) {
    details.push({
      field: 'emails',
      message: "You're the team leader, so you don't need an invite.",
    });
  }

  const currentCount = team.members.filter((m) => m.status !== MEMBER_STATUS.DECLINED).length;
  if (currentCount + emails.length > MAX_TEAM_SIZE) {
    details.push({
      field: 'emails',
      message: `A team has at most ${MAX_TEAM_SIZE} members (currently ${currentCount}).`,
    });
  }

  if (details.length > 0) throw ApiError.validationError(details);

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const createdMembers = [];

  for (const email of emails) {
    const existing = team.members.find((m) => m.email.toLowerCase() === email);
    if (existing && [MEMBER_STATUS.JOINED, MEMBER_STATUS.INVITED].includes(existing.status)) {
      continue;
    }

    const token = generateRandomToken();
    const member = await prisma.teamMember.create({
      data: {
        teamId: team.id,
        email,
        status: MEMBER_STATUS.INVITED,
        isLeader: false,
        inviteToken: token,
        inviteExpiresAt: expiresAt,
      },
    });

    createdMembers.push(member);

    try {
      await sendTeamInviteEmail(email, req.user.name, team.name, token);
    } catch (err) {
      logger.warn('Failed to send team invite email:', err.message);
    }
  }

  created(res, { items: createdMembers.map(teamMemberDto) });
});

const resendInvite = asyncHandler(async (req, res) => {
  const { id, inviteId } = req.params;
  const team = await checkTeamAccess(id, req.user, { leaderOnly: true });

  if (!OPEN_STATUSES.includes(team.status)) {
    throw ApiError.conflict('INVALID_TRANSITION', 'This team can no longer change its members.');
  }

  const member = team.members.find((m) => m.id === inviteId);
  if (!member || member.isLeader) throw ApiError.notFound('Invite not found.');
  if (member.status !== MEMBER_STATUS.INVITED) {
    throw ApiError.conflict('INVALID_TRANSITION', 'Only pending invites can be sent again.');
  }

  const token = generateRandomToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const updated = await prisma.teamMember.update({
    where: { id: member.id },
    data: {
      inviteToken: token,
      invitedAt: new Date(),
      inviteExpiresAt: expiresAt,
    },
  });

  try {
    await sendTeamInviteEmail(member.email, req.user.name, team.name, token);
  } catch (err) {
    logger.warn('Failed to resend team invite email:', err.message);
  }

  ok(res, teamMemberDto(updated));
});

const cancelInvite = asyncHandler(async (req, res) => {
  const { id, inviteId } = req.params;
  const team = await checkTeamAccess(id, req.user, { leaderOnly: true });

  if (!OPEN_STATUSES.includes(team.status)) {
    throw ApiError.conflict('INVALID_TRANSITION', 'This team can no longer change its members.');
  }

  const member = team.members.find((m) => m.id === inviteId);
  if (!member || member.isLeader) throw ApiError.notFound('Invite not found.');
  if (member.status !== MEMBER_STATUS.INVITED) {
    throw ApiError.conflict('INVALID_TRANSITION', 'Only pending invites can be cancelled.');
  }

  await prisma.teamMember.update({
    where: { id: member.id },
    data: { status: MEMBER_STATUS.REMOVED },
  });

  noContent(res);
});

const getTeamReadiness = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const team = await checkTeamAccess(id, req.user);
  const readiness = await computeTeamReadiness(team);
  ok(res, readiness);
});

const updateTeamRepo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const team = await checkTeamAccess(id, req.user, { leaderOnly: true });

  if (team.status === TEAM_STATUS.DISBANDED) {
    throw ApiError.conflict('INVALID_TRANSITION', 'This team was disbanded.');
  }

  const repoUrl = String(req.body.repoUrl || '').trim().replace(/\/+$/, '');
  if (!GITHUB_REPO_URL_RE.test(repoUrl)) {
    throw ApiError.validationError([
      { field: 'repoUrl', message: 'Use a repository URL like https://github.com/owner/repository.' },
    ]);
  }

  const updated = await prisma.team.update({
    where: { id: team.id },
    data: { repoUrl },
    include: {
      leader: true,
      plan: { include: { designation: true, domain: true } },
      members: { include: { user: true } },
    },
  });

  ok(res, teamDto(updated));
});

const getTeamProgress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const team = await checkTeamAccess(id, req.user, { joinedOnly: true });

  const progress = await prisma.taskProgress.findMany({
    where: { teamId: team.id },
    include: { task: true },
    orderBy: { task: { sequence: 'asc' } },
  });

  const progressIds = progress.map((p) => p.id);
  const submissions = await prisma.taskSubmission.findMany({
    where: { taskProgressId: { in: progressIds } },
    include: { submittedBy: true },
  });

  const memberIds = [
    team.leaderId,
    ...team.members
      .filter((m) => m.status === MEMBER_STATUS.JOINED && m.userId)
      .map((m) => m.userId),
  ];

  const uniqueMemberIds = [...new Set(memberIds)];
  const userMap = new Map();
  team.members.forEach((m) => {
    if (m.userId) userMap.set(m.userId, m.user?.name || m.name);
  });
  userMap.set(team.leaderId, team.leader?.name);

  const contributions = uniqueMemberIds.map((userId) => {
    const mine = submissions.filter((s) => s.submittedById === userId);
    const lastSubmittedAt =
      mine
        .map((s) => s.submittedAt)
        .filter(Boolean)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;

    return {
      userId,
      name: userMap.get(userId) || 'Team member',
      submissions: mine.length,
      lastSubmittedAt,
    };
  });

  ok(res, {
    teamId: team.id,
    tasks: progress.map((p) => ({
      _id: p.id,
      enrollmentId: p.enrollmentId,
      teamId: p.teamId,
      taskId: p.taskId,
      status: p.status,
      startedAt: p.startedAt,
      submittedAt: p.submittedAt,
      approvedAt: p.approvedAt,
      attempts: p.attempts,
      lastReviewStatus: p.lastReviewStatus,
      task: p.task
        ? {
            _id: p.task.id,
            title: p.task.title,
            sequence: p.task.sequence,
            dayNumber: p.task.dayNumber,
            estimatedHours: p.task.estimatedHours,
            requiresTrainerReview: p.task.requiresTrainerReview,
          }
        : null,
    })),
    contributions,
  });
});

module.exports = {
  getMyTeams,
  getInviteDetails,
  acceptInvite,
  declineInvite,
  createTeam,
  getTeamById,
  inviteMembers,
  resendInvite,
  cancelInvite,
  getTeamReadiness,
  updateTeamRepo,
  getTeamProgress,
};
