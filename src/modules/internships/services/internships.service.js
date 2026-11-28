const { InternshipsModel, flattenPositions } = require('../internships.model');
const {
  BASE_WEB_RESPONSIBILITIES,
  BASE_APP_RESPONSIBILITIES,
  BASE_WEB_SKILLS,
  BASE_APP_SKILLS,
  COLOR_THEMES,
  PRICING_DURATIONS,
  DEFAULT_DURATION_PRICES,
  DEFAULT_CONCESSION_PERCENT,
} = require('../constants');
const { addAudit } = require('../../audit-log/audit-log.service');
const { ApiError } = require('../../../utils');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseDurationMonths(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  const matched = String(value || '').match(/\d+/);
  return matched ? parseInt(matched[0], 10) : 3;
}

function normalizeDurationMap(rawMap = {}, fallbackMap = DEFAULT_DURATION_PRICES) {
  const result = {};
  PRICING_DURATIONS.forEach((m) => {
    const key = String(m);
    const val = rawMap?.[key] ?? rawMap?.[m];
    const parsed = Number(val);
    result[key] = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallbackMap[m] ?? 1999;
  });
  return result;
}

function normalizePricing(rawPricing = {}, domains = []) {
  const rawConcession = Number(rawPricing?.concessionPercent);
  const concessionPercent = Number.isFinite(rawConcession)
    ? Math.min(100, Math.max(0, Math.round(rawConcession)))
    : DEFAULT_CONCESSION_PERCENT;

  const defaultPrices = normalizeDurationMap(rawPricing?.defaultPrices, DEFAULT_DURATION_PRICES);
  const domainPrices = {};
  const incomingDomains = rawPricing?.domainPrices && typeof rawPricing.domainPrices === 'object'
    ? rawPricing.domainPrices
    : {};

  // Keep any explicitly provided domain pricing entries
  Object.entries(incomingDomains).forEach(([domKey, map]) => {
    const clean = String(domKey || '').trim();
    if (clean && map && typeof map === 'object') {
      domainPrices[clean] = normalizeDurationMap(map, defaultPrices);
    }
  });

  // Ensure every assigned domain has an initialized entry
  (Array.isArray(domains) ? domains : []).forEach((dom) => {
    const clean = String(dom || '').trim();
    if (clean && !domainPrices[clean]) {
      domainPrices[clean] = { ...defaultPrices };
    }
  });

  const projectPrices = {};
  const incomingProjects =
    rawPricing?.projectPrices && typeof rawPricing.projectPrices === 'object'
      ? rawPricing.projectPrices
      : {};

  Object.entries(incomingProjects).forEach(([domKey, projMap]) => {
    const cleanDom = String(domKey || '').trim();
    if (!cleanDom || !projMap || typeof projMap !== 'object') return;
    const fallbackDom = domainPrices[cleanDom] || defaultPrices;
    const normalizedProjMap = {};
    Object.entries(projMap).forEach(([projKey, durMap]) => {
      const cleanProj = String(projKey || '').trim();
      if (cleanProj && durMap && typeof durMap === 'object') {
        normalizedProjMap[cleanProj] = normalizeDurationMap(durMap, fallbackDom);
      }
    });
    if (Object.keys(normalizedProjMap).length > 0) {
      projectPrices[cleanDom] = normalizedProjMap;
    }
  });

  return {
    concessionPercent,
    defaultPrices,
    domainPrices,
    projectPrices,
  };
}

function findDomainPriceMap(domainPrices, domainName) {
  if (!domainPrices || typeof domainPrices !== 'object' || !domainName) return null;
  const target = String(domainName).trim().toLowerCase();
  const matchedKey = Object.keys(domainPrices).find(
    (k) => k.trim().toLowerCase() === target,
  );
  return matchedKey ? domainPrices[matchedKey] : null;
}

function findProjectPriceMap(projectPrices, domainName, projectKeys = []) {
  if (!projectPrices || typeof projectPrices !== 'object') return null;
  const candidates = (Array.isArray(projectKeys) ? projectKeys : [projectKeys])
    .map((k) => String(k || '').trim().toLowerCase())
    .filter(Boolean);
  if (candidates.length === 0) return null;

  const domainMaps = domainName
    ? [findDomainPriceMap(projectPrices, domainName)].filter(Boolean)
    : Object.values(projectPrices).filter((m) => m && typeof m === 'object');

  for (const projMap of domainMaps) {
    for (const candidate of candidates) {
      const matchedKey = Object.keys(projMap).find(
        (k) => k.trim().toLowerCase() === candidate,
      );
      if (matchedKey) return projMap[matchedKey];
    }
  }
  return null;
}

function calculateInternshipPrice({
  role,
  partner,
  domainName,
  projectId,
  projectTitle,
  projectSlug,
  durationMonths,
}) {
  const dur = parseDurationMonths(durationMonths);
  const durKey = String(dur);
  const projectKeys = [projectId, projectSlug, projectTitle];

  const rolePricing = role?.pricing;
  const partnerPricing = partner?.pricing;

  const roleProjectMap = findProjectPriceMap(rolePricing?.projectPrices, domainName, projectKeys);
  const partnerProjectMap = findProjectPriceMap(partnerPricing?.projectPrices, domainName, projectKeys);
  const roleDomainMap = findDomainPriceMap(rolePricing?.domainPrices, domainName);
  const partnerDomainMap = findDomainPriceMap(partnerPricing?.domainPrices, domainName);

  const rawBase =
    roleProjectMap?.[durKey] ??
    partnerProjectMap?.[durKey] ??
    roleDomainMap?.[durKey] ??
    partnerDomainMap?.[durKey] ??
    rolePricing?.defaultPrices?.[durKey] ??
    partnerPricing?.defaultPrices?.[durKey] ??
    DEFAULT_DURATION_PRICES[dur] ??
    1999;

  const basePrice = Math.max(0, Math.round(Number(rawBase) || 0));
  const rawConcession =
    rolePricing?.concessionPercent ??
    partnerPricing?.concessionPercent ??
    DEFAULT_CONCESSION_PERCENT;
  const concessionPercent = Math.min(100, Math.max(0, Math.round(Number(rawConcession) || 0)));
  const discountAmount = Math.round(basePrice * (concessionPercent / 100));
  const payableAmount = Math.max(0, basePrice - discountAmount);

  return {
    durationMonths: dur,
    domainName: domainName || partner?.assignedDomains?.[0] || partner?.domain || '',
    projectId: projectId || null,
    projectTitle: projectTitle || null,
    basePrice,
    concessionPercent,
    discountAmount,
    payableAmount,
    payablePaise: payableAmount * 100,
    currency: 'INR',
  };
}

class InternshipsService {
  /**
   * List positions with filtering and search.
   */
  static listPositions({ search = '', track = 'all', domain = 'all', page = 1, limit = 50 } = {}) {
    const companies = InternshipsModel.getCompanies();
    const allPositions = flattenPositions(companies);

    const filtered = allPositions.filter(({ partner, role }) => {
      if (search && search.trim()) {
        const query = search.trim().toLowerCase();
        const matchesCompany = partner.name?.toLowerCase().includes(query);
        const matchesRole =
          role.role?.toLowerCase().includes(query) ||
          role.designation?.toLowerCase().includes(query);
        const matchesDomain =
          partner.domain?.toLowerCase().includes(query) ||
          role.domains?.some((d) => d.toLowerCase().includes(query));
        if (!matchesCompany && !matchesRole && !matchesDomain) return false;
      }

      if (track && track !== 'all' && role.track !== track) {
        return false;
      }

      if (domain && domain !== 'all') {
        const matchesMain =
          partner.domain === domain ||
          partner.domainSlug === domain ||
          partner.domainCategory === domain;
        const matchesAssigned =
          role.domains?.includes(domain) ||
          partner.assignedDomains?.includes(domain) ||
          role.domains?.some((d) => d.toLowerCase() === domain.toLowerCase());
        if (!matchesMain && !matchesAssigned) return false;
      }

      return true;
    });

    const total = filtered.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 50);
    const startIndex = (pageNum - 1) * limitNum;
    const items = filtered.slice(startIndex, startIndex + limitNum);

    const stats = {
      totalPositions: allPositions.length,
      partnerCompanies: companies.length,
      webPositions: allPositions.filter((p) => p.role.track === 'web').length,
      appPositions: allPositions.filter((p) => p.role.track === 'app').length,
    };

    return {
      items,
      companies,
      stats,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };
  }

  /**
   * Get single position by ID.
   */
  static getPositionById(id) {
    const position = InternshipsModel.findPositionById(id);
    if (!position) {
      throw ApiError.notFound('Internship position not found.');
    }
    return position;
  }

  /**
   * Add or update an internship position.
   */
  static async savePosition(formData, originalRoleId = null, { actorId, ip } = {}) {
    const companies = InternshipsModel.getCompanies();
    const track = formData.track || 'web';
    const isWeb = track === 'web';

    const companyName = (formData.companyName || 'Partner Company').trim();
    const companySlug = slugify(companyName);
    const theme = COLOR_THEMES[formData.themeColor || 'blue'] || COLOR_THEMES.blue;

    const roleTitle = (formData.role || 'Trainee Software Engineer').trim();
    const designation = (
      formData.designation || `${roleTitle} – ${isWeb ? 'Web Development' : 'App Development'}`
    ).trim();
    const trackLabel = isWeb ? 'Web Development' : 'App Development';
    const trackType =
      formData.trackType ||
      (isWeb ? 'Full Stack Web Engineering Track' : 'Mobile Application Engineering Track');

    const assignedDomains = Array.isArray(formData.assignedDomains)
      ? formData.assignedDomains
      : typeof formData.assignedDomains === 'string'
        ? formData.assignedDomains.split(',').map((d) => d.trim()).filter(Boolean)
        : ['General Tech'];

    const domainCategory = formData.domainCategory || slugify(assignedDomains[0] || 'tech');
    const domain = formData.domain || `${assignedDomains[0] || 'Tech'} Domain`;

    const responsibilities =
      Array.isArray(formData.rolesAndResponsibilities) &&
      formData.rolesAndResponsibilities.length > 0
        ? formData.rolesAndResponsibilities
        : isWeb
          ? [...BASE_WEB_RESPONSIBILITIES]
          : [...BASE_APP_RESPONSIBILITIES];

    const skills =
      Array.isArray(formData.skillsRequired) && formData.skillsRequired.length > 0
        ? formData.skillsRequired
        : isWeb
          ? [...BASE_WEB_SKILLS]
          : [...BASE_APP_SKILLS];

    const perks =
      Array.isArray(formData.perks) && formData.perks.length > 0
        ? formData.perks
        : [
            'Official Internship Completion Letter',
            'Dedicated 1-on-1 Industry Mentor',
            'Placement Support & Interview Drives',
          ];

    const keyDeliverables =
      Array.isArray(formData.keyDeliverables) && formData.keyDeliverables.length > 0
        ? formData.keyDeliverables
        : [
            `Develop responsive, scalable application modules across ${assignedDomains.join(' & ')}.`,
            'Implement authentication, state management, and modern API endpoints.',
            'Collaborate on git version control, code reviews, and production testing.',
          ];

    const techStack = Array.isArray(formData.techStack)
      ? formData.techStack
      : typeof formData.techStack === 'string'
        ? formData.techStack.split(',').map((s) => s.trim()).filter(Boolean)
        : isWeb
          ? ['HTML5', 'CSS3', 'JavaScript', 'React.js', 'Node.js', 'REST APIs', 'Git']
          : ['Kotlin / Java', 'Flutter', 'Android Studio', 'Firebase', 'REST APIs', 'Git'];

    const roleId = originalRoleId || formData.id || `${companySlug}-${track}-${Date.now()}`;

    const normalizedPricing = normalizePricing(formData.pricing, assignedDomains);

    const assembledRole = {
      id: roleId,
      track,
      trackLabel,
      designation,
      role: roleTitle,
      fullRoleName: `${designation} – ${assignedDomains.join(' & ')}`,
      trackType,
      domains: assignedDomains,
      level: formData.level || 'Undergraduate / Graduate',
      duration: formData.duration || '1 to 6 Months',
      durationsList: formData.durationsList || [
        '1 month',
        '2 months',
        '3 months',
        '4 months',
        '5 months',
        '6 months',
      ],
      workMode: formData.workMode || '100% Online Remote',
      applicantsCount: Number(formData.applicantsCount) || 120,
      description:
        formData.description ||
        `As a ${designation} Intern at ${companyName}, candidates will work on designing, developing, testing, and maintaining production applications across the ${assignedDomains.join(
          ' and ',
        )} domains.`,
      rolesAndResponsibilities: responsibilities,
      baseResponsibilities: responsibilities,
      keyDeliverables,
      techStack,
      skillsRequired: skills,
      perks,
      eligibility:
        formData.eligibility ||
        (isWeb
          ? 'B.Tech / B.E / BCA / MCA with core programming and web fundamentals.'
          : 'B.Tech / B.E / BCA / MCA with mobile development or OOP fundamentals.'),
      pricing: normalizedPricing,
    };

    let targetCompanyIndex = -1;

    if (originalRoleId) {
      targetCompanyIndex = companies.findIndex((c) =>
        c.roles?.some((r) => r.id === originalRoleId),
      );
    }

    if (targetCompanyIndex === -1) {
      targetCompanyIndex = companies.findIndex(
        (c) => c.slug === companySlug || c.name.toLowerCase() === companyName.toLowerCase(),
      );
    }

    if (targetCompanyIndex !== -1) {
      const company = companies[targetCompanyIndex];
      company.name = companyName;
      company.domain = domain;
      company.domainCategory = domainCategory;
      company.assignedDomains = assignedDomains;
      company.assignedDomainSlugs = assignedDomains.map(slugify);
      if (formData.tagline) company.tagline = formData.tagline;
      if (formData.logoInitials) company.logoInitials = formData.logoInitials;
      if (formData.logoUrl !== undefined) {
        const trimmedLogoUrl = typeof formData.logoUrl === 'string' ? formData.logoUrl.trim() : '';
        if (trimmedLogoUrl) {
          company.logoUrl = trimmedLogoUrl;
        } else {
          delete company.logoUrl;
        }
      }
      if (theme.logoBg) company.logoBg = theme.logoBg;
      if (theme.gradient) company.gradient = theme.gradient;
      if (theme.accentBorder) company.accentBorder = theme.accentBorder;
      if (theme.badgeTint) company.badgeTint = theme.badgeTint;

      if (!Array.isArray(company.roles)) {
        company.roles = [];
      }

      const roleIndex = company.roles.findIndex((r) => r.id === roleId);
      if (roleIndex !== -1) {
        company.roles[roleIndex] = assembledRole;
      } else {
        company.roles.push(assembledRole);
      }
    } else {
      const newCompany = {
        id: companySlug,
        name: companyName,
        slug: companySlug,
        domain,
        domainSlug: slugify(assignedDomains[0] || 'tech'),
        domainCategory,
        assignedDomains,
        assignedDomainSlugs: assignedDomains.map(slugify),
        tagline: formData.tagline || `${companyName} engineering internship program`,
        location: formData.workMode || '100% Online Remote',
        rating: '4.9',
        hiringBatch: 'Batch 2026 / 2027',
        gradient: theme.gradient,
        accentBorder: theme.accentBorder,
        badgeTint: theme.badgeTint,
        logoBg: theme.logoBg,
        ...(typeof formData.logoUrl === 'string' && formData.logoUrl.trim()
          ? { logoUrl: formData.logoUrl.trim() }
          : {}),
        logoInitials:
          formData.logoInitials ||
          companyName
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase(),
        stats: {
          teamSize: '100+ Engineers',
          placementAssistance: 'Placement Support',
          mentors: 'Senior Technical Architects',
        },
        roles: [assembledRole],
      };
      companies.push(newCompany);
    }

    InternshipsModel.saveCompanies(companies);

    if (actorId) {
      await addAudit({
        actorId,
        action: originalRoleId ? 'INTERNSHIP_UPDATED' : 'INTERNSHIP_CREATED',
        entityType: 'PartnerInternship',
        entityId: roleId,
        after: { companyName, roleId, designation, track },
        ip,
      });
    }

    return {
      role: assembledRole,
      partner: companies[targetCompanyIndex !== -1 ? targetCompanyIndex : companies.length - 1],
    };
  }

  /**
   * Delete an internship position.
   */
  static async deletePosition(roleId, { actorId, ip } = {}) {
    const companies = InternshipsModel.getCompanies();
    let deleted = false;

    companies.forEach((company) => {
      if (Array.isArray(company.roles)) {
        const initialLen = company.roles.length;
        company.roles = company.roles.filter(
          (r) => r.id !== roleId && `${company.id}-${r.id}` !== roleId,
        );
        if (company.roles.length < initialLen) {
          deleted = true;
        }
      }
    });

    // Remove empty companies that have no roles left
    const remainingCompanies = companies.filter(
      (c) => Array.isArray(c.roles) && c.roles.length > 0,
    );

    InternshipsModel.saveCompanies(remainingCompanies);

    if (actorId && deleted) {
      await addAudit({
        actorId,
        action: 'INTERNSHIP_DELETED',
        entityType: 'PartnerInternship',
        entityId: roleId,
        before: { roleId },
        ip,
      });
    }

    return { success: true, deletedRoleId: roleId };
  }

  /**
   * Resolve pricing breakdown for a given internship/company + domain + duration.
   */
  static getQuote({
    internshipId,
    companyName,
    domainName,
    projectId,
    projectTitle,
    projectSlug,
    durationMonths,
  } = {}) {
    const companies = InternshipsModel.getCompanies();
    let matchedPartner = null;
    let matchedRole = null;

    if (internshipId) {
      const pos = InternshipsModel.findPositionById(internshipId);
      if (pos) {
        matchedPartner = pos.partner;
        matchedRole = pos.role;
      }
    }

    if (!matchedPartner && companyName) {
      const target = String(companyName).trim().toLowerCase();
      matchedPartner = companies.find(
        (c) => c.name?.toLowerCase() === target || c.slug?.toLowerCase() === target,
      ) || null;
      matchedRole = matchedPartner?.roles?.[0] || null;
    }

    return calculateInternshipPrice({
      role: matchedRole,
      partner: matchedPartner,
      domainName,
      projectId,
      projectTitle,
      projectSlug,
      durationMonths,
    });
  }

  /**
   * Reset all partner internships to default 4 companies and 8 positions.
   */
  static async resetToDefaults({ actorId, ip } = {}) {
    const defaults = InternshipsModel.resetToDefaults();

    if (actorId) {
      await addAudit({
        actorId,
        action: 'INTERNSHIPS_RESET',
        entityType: 'PartnerInternship',
        entityId: 'all',
        after: { count: defaults.length },
        ip,
      });
    }

    return defaults;
  }
}

module.exports = { InternshipsService, calculateInternshipPrice, normalizePricing };
