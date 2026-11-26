/**
 * Central constants and baseline seed data for Partner Internships catalog.
 * Follows SOLID principles: single source of truth for standard responsibilities,
 * technical skills, color themes, and partner companies.
 */

const BASE_WEB_RESPONSIBILITIES = Object.freeze([
  'Develop responsive and user-friendly web applications using modern frontend technologies.',
  'Design and implement interactive user interfaces using HTML, CSS, JavaScript, and modern frameworks.',
  'Develop backend functionality, business logic, and RESTful APIs.',
  'Work with databases to store, retrieve, update, and manage application data.',
  'Implement user authentication, authorization, and role-based access control.',
  'Integrate frontend applications with backend services and third-party APIs.',
  'Develop and maintain modules such as user management, dashboards, reports, payment workflows, and administrative panels.',
  'Perform application testing, debugging, and troubleshooting.',
  'Collaborate with team members to understand project requirements and implement solutions.',
  'Maintain technical documentation and follow software development best practices.',
  'Participate in project reviews, code reviews, and development activities.',
  'Work on domain-specific business requirements and implement real-world software solutions.',
]);

const BASE_APP_RESPONSIBILITIES = Object.freeze([
  'Design and develop user-friendly mobile applications for Android and cross-platform environments.',
  'Build interactive application interfaces with proper navigation and responsive layouts.',
  'Develop application functionality using Java, Kotlin, Flutter, or React Native.',
  'Integrate mobile applications with backend services and RESTful APIs.',
  'Implement user registration, login, authentication, and authorization functionalities.',
  'Integrate databases and manage application data efficiently.',
  'Implement features such as notifications, user profiles, dashboards, and transaction workflows.',
  'Integrate third-party services such as payment gateways, maps, and notification services.',
  'Perform application testing, debugging, and performance optimization.',
  'Ensure application compatibility across different devices and screen sizes.',
  'Collaborate with backend developers, UI/UX designers, and project team members.',
  'Prepare technical documentation and participate in project reviews.',
  'Understand domain-specific requirements and implement mobile solutions based on real-world business scenarios.',
]);

const BASE_WEB_SKILLS = Object.freeze([
  'HTML5, CSS3, and JavaScript.',
  'React.js / Angular / Vue.js (any one preferred).',
  'Core Java / Python / Node.js / PHP (any one preferred).',
  'SQL and database concepts (MySQL / PostgreSQL / MongoDB).',
  'REST API development and integration.',
  'Git and GitHub for version control.',
  'Responsive web design and UI/UX fundamentals.',
  'Basic knowledge of authentication and authorization.',
]);

const BASE_APP_SKILLS = Object.freeze([
  'Core Java / Kotlin / Dart (any one preferred).',
  'Android Studio and Android development fundamentals.',
  'Flutter / React Native (any one preferred).',
  'XML and UI layout fundamentals.',
  'REST API integration.',
  'JSON data handling.',
  'Firebase / SQLite / Room Database / MySQL fundamentals.',
  'Git and GitHub.',
  'Mobile application architecture and navigation.',
  'Basic knowledge of debugging and application testing.',
]);

const COLOR_THEMES = Object.freeze({
  emerald: {
    label: 'Emerald (FinTech / Banking)',
    logoBg: 'bg-emerald-600',
    gradient: 'from-emerald-600 via-teal-600 to-cyan-700',
    accentBorder: 'border-emerald-500/30 hover:border-emerald-500',
    badgeTint: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  },
  blue: {
    label: 'Blue (Telecom / Cloud)',
    logoBg: 'bg-blue-600',
    gradient: 'from-blue-600 via-indigo-600 to-sky-600',
    accentBorder: 'border-blue-500/30 hover:border-blue-500',
    badgeTint: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  },
  rose: {
    label: 'Rose (Healthcare / MedTech)',
    logoBg: 'bg-rose-600',
    gradient: 'from-rose-600 via-pink-600 to-amber-600',
    accentBorder: 'border-rose-500/30 hover:border-rose-500',
    badgeTint: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
  },
  purple: {
    label: 'Purple (Enterprise SaaS / AI)',
    logoBg: 'bg-purple-600',
    gradient: 'from-purple-600 via-violet-600 to-indigo-700',
    accentBorder: 'border-purple-500/30 hover:border-purple-500',
    badgeTint: 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
  },
  amber: {
    label: 'Amber (Cybersecurity / Analytics)',
    logoBg: 'bg-amber-600',
    gradient: 'from-amber-600 via-orange-600 to-yellow-600',
    accentBorder: 'border-amber-500/30 hover:border-amber-500',
    badgeTint: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  },
  cyan: {
    label: 'Cyan (Robotics / IoT)',
    logoBg: 'bg-cyan-600',
    gradient: 'from-cyan-600 via-teal-600 to-blue-600',
    accentBorder: 'border-cyan-500/30 hover:border-cyan-500',
    badgeTint: 'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800',
  },
});

const PRICING_DURATIONS = Object.freeze([1, 2, 3, 6]);
const DEFAULT_DURATION_PRICES = Object.freeze({
  1: 999,
  2: 1499,
  3: 1999,
  6: 2999,
});
const DEFAULT_CONCESSION_PERCENT = 0;

function buildDefaultPricing(domains = []) {
  const domainPrices = {};
  (Array.isArray(domains) ? domains : []).forEach((dom) => {
    const clean = String(dom || '').trim();
    if (clean) {
      domainPrices[clean] = { ...DEFAULT_DURATION_PRICES };
    }
  });
  return {
    concessionPercent: DEFAULT_CONCESSION_PERCENT,
    defaultPrices: { ...DEFAULT_DURATION_PRICES },
    domainPrices,
  };
}

function createInternshipRole({
  id,
  track,
  companyName,
  designation,
  roleTitle,
  domains,
  description,
  keyDeliverables = [],
  techStack = [],
  skills = [],
  applicantsCount = 130,
  pricing,
}) {
  const isWeb = track === 'web';
  const commonResp = isWeb ? BASE_WEB_RESPONSIBILITIES : BASE_APP_RESPONSIBILITIES;
  const commonSkills = isWeb ? BASE_WEB_SKILLS : BASE_APP_SKILLS;

  const roleOverview =
    description ||
    (isWeb
      ? `As a Trainee Software Engineer – Web Development Intern at ${companyName}, candidates will work on designing, developing, testing, and maintaining responsive web applications across the ${domains.join(' and ')} domains.`
      : `As a Trainee Software Engineer – App Development Intern at ${companyName}, candidates will participate in designing, developing, testing, and maintaining mobile applications across the ${domains.join(' and ')} domains.`);

  return {
    id,
    track,
    trackLabel: isWeb ? 'Web Development' : 'App Development',
    designation,
    role: roleTitle,
    fullRoleName: `${designation} – ${domains.join(' & ')}`,
    trackType: isWeb ? 'Full Stack Web Engineering Track' : 'Mobile Application Engineering Track',
    domains,
    level: 'Undergraduate / Graduate',
    duration: '1 to 6 Months',
    durationsList: ['1 month', '2 months', '3 months', '4 months', '5 months', '6 months'],
    workMode: '100% Online Remote',
    applicantsCount,
    description: roleOverview,
    rolesAndResponsibilities: commonResp,
    baseResponsibilities: commonResp,
    keyDeliverables,
    techStack,
    skillsRequired: skills.length > 0 ? skills : commonSkills,
    perks: [
      'Official Internship Completion Letter',
      'Dedicated 1-on-1 Industry Mentor',
      'Placement Support & Interview Drives',
    ],
    eligibility: isWeb
      ? 'B.Tech / B.E / BCA / MCA with core programming and web fundamentals.'
      : 'B.Tech / B.E / BCA / MCA with mobile development or OOP fundamentals.',
    pricing: pricing || buildDefaultPricing(domains),
  };
}

const DEFAULT_PARTNER_COMPANIES = [
  {
    id: 'inlarge-software',
    name: 'Inlarge Software',
    slug: 'inlarge-software',
    domain: 'Banking & FinTech',
    domainSlug: 'banking',
    domainCategory: 'banking',
    assignedDomains: ['Banking', 'Finance'],
    assignedDomainSlugs: ['banking', 'finance'],
    tagline: 'Enterprise core banking, payment settlement & ledger infrastructure',
    location: '100% Online Remote',
    rating: '4.9',
    hiringBatch: 'Batch 2026 / 2027',
    gradient: 'from-emerald-600 via-teal-600 to-cyan-700',
    accentBorder: 'border-emerald-500/30 hover:border-emerald-500',
    badgeTint: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    logoBg: 'bg-emerald-600',
    logoInitials: 'IS',
    stats: {
      teamSize: '250+ Engineers',
      placementAssistance: 'Placement Support',
      mentors: 'Senior FinTech Architects',
    },
    roles: [
      createInternshipRole({
        id: 'inlarge-fintech-eng',
        track: 'web',
        companyName: 'Inlarge Software',
        designation: 'Trainee Software Engineer – Web Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['Banking', 'Finance'],
        description:
          'As a Trainee Software Engineer – Web Development Intern at Inlarge Software, candidates will work on designing, developing, testing, and maintaining responsive web applications across Banking and Finance domains.',
        keyDeliverables: [
          'Develop responsive customer banking portals and ledger reconciliation dashboards.',
          'Implement secure user authentication, role-based access control, and payment gateway workflows.',
          'Build RESTful APIs and integrate databases with automated transaction testing and audit trails.',
        ],
        techStack: ['HTML5 / CSS3', 'JavaScript', 'React.js', 'Core Java', 'PostgreSQL', 'REST APIs', 'Git'],
        applicantsCount: 142,
      }),
      createInternshipRole({
        id: 'inlarge-fintech-app',
        track: 'app',
        companyName: 'Inlarge Software',
        designation: 'Trainee Software Engineer – App Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['Banking', 'Finance'],
        description:
          'As a Trainee Software Engineer – App Development Intern at Inlarge Software, candidates will participate in designing, developing, testing, and maintaining mobile applications for Android and cross-platform environments.',
        keyDeliverables: [
          'Design and build interactive mobile banking apps with responsive layouts and smooth navigation.',
          'Implement biometric authentication, secure transaction workflows, and push notifications.',
          'Integrate RESTful banking services, local database caching, and third-party payment gateways.',
        ],
        techStack: ['Kotlin / Java', 'Flutter', 'Android Studio', 'Room DB', 'REST APIs', 'Firebase', 'Git'],
        applicantsCount: 128,
      }),
    ],
  },
  {
    id: 'couldinger',
    name: 'Couldinger',
    slug: 'couldinger',
    domain: 'Telecom & Networks',
    domainSlug: 'telecom',
    domainCategory: 'telecom',
    assignedDomains: ['Telecom', 'E-commerce'],
    assignedDomainSlugs: ['telecom', 'e-commerce'],
    tagline: 'Next-gen telecom orchestration, 5G edge routing & e-commerce platforms',
    location: '100% Online Remote',
    rating: '4.8',
    hiringBatch: 'Batch 2026 / 2027',
    gradient: 'from-blue-600 via-indigo-600 to-sky-600',
    accentBorder: 'border-blue-500/30 hover:border-blue-500',
    badgeTint: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    logoBg: 'bg-blue-600',
    logoInitials: 'CD',
    stats: {
      teamSize: '400+ Systems Engineers',
      placementAssistance: 'Placement Support',
      mentors: 'Principal Cloud Architects',
    },
    roles: [
      createInternshipRole({
        id: 'couldinger-cloud-devops',
        track: 'web',
        companyName: 'Couldinger',
        designation: 'Trainee Software Engineer – Web Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['Telecom', 'E-commerce'],
        description:
          'As a Trainee Software Engineer – Web Development Intern at Couldinger, candidates will work on designing, developing, testing, and maintaining responsive web applications across Telecom and E-commerce domains.',
        keyDeliverables: [
          'Develop responsive subscriber self-care and retail shopping web portals using modern frameworks.',
          'Build backend REST APIs for subscriber billing, plan recharges, product catalogs, and cart checkouts.',
          'Work with databases and third-party APIs for payment gateways, SMS notifications, and telemetry reporting.',
        ],
        techStack: ['HTML5 / CSS3', 'JavaScript', 'React.js', 'Node.js', 'PostgreSQL', 'Docker', 'Git'],
        applicantsCount: 189,
      }),
      createInternshipRole({
        id: 'couldinger-mobile-app',
        track: 'app',
        companyName: 'Couldinger',
        designation: 'Trainee Software Engineer – App Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['Telecom', 'E-commerce'],
        description:
          'As a Trainee Software Engineer – App Development Intern at Couldinger, candidates will participate in designing, developing, testing, and maintaining mobile applications for Android and cross-platform environments.',
        keyDeliverables: [
          'Build mobile application interfaces for catalog shopping, instant mobile recharges, and order tracking.',
          'Integrate Google Maps SDK for store locations, push notifications for flash deals, and payment gateways.',
          'Manage offline caching with SQLite/Room and optimize app performance across Android devices.',
        ],
        techStack: ['Flutter / Dart', 'React Native', 'Android Studio', 'Firebase', 'SQLite', 'REST APIs', 'Git'],
        applicantsCount: 145,
      }),
    ],
  },
  {
    id: 'proton',
    name: 'Proton',
    slug: 'proton',
    domain: 'Healthcare & MedTech',
    domainSlug: 'healthcare',
    domainCategory: 'healthcare',
    assignedDomains: ['Healthcare', 'Insurance'],
    assignedDomainSlugs: ['healthcare', 'insurance'],
    tagline: 'HIPAA-compliant health tech, clinical telemetry & insurance claims',
    location: '100% Online Remote',
    rating: '4.9',
    hiringBatch: 'Batch 2026 / 2027',
    gradient: 'from-rose-600 via-pink-600 to-amber-600',
    accentBorder: 'border-rose-500/30 hover:border-rose-500',
    badgeTint: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    logoBg: 'bg-rose-600',
    logoInitials: 'PR',
    stats: {
      teamSize: '180+ MedTech Engineers',
      placementAssistance: 'Placement Support',
      mentors: 'Healthcare IT Directors',
    },
    roles: [
      createInternshipRole({
        id: 'proton-healthcare-fullstack',
        track: 'web',
        companyName: 'Proton',
        designation: 'Trainee Software Engineer – Web Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['Healthcare', 'Insurance'],
        description:
          'As a Trainee Software Engineer – Web Development Intern at Proton, candidates will work on designing, developing, testing, and maintaining responsive web applications across Healthcare and Insurance domains.',
        keyDeliverables: [
          'Build accessible, responsive patient and doctor portals with strict data privacy and role-based access control.',
          'Develop backend REST APIs for health records, appointment scheduling, and insurance claim adjudication.',
          'Integrate third-party diagnostic APIs, laboratory reports, and encrypted databases.',
        ],
        techStack: ['HTML5 / CSS3', 'JavaScript', 'React.js', 'Node.js / Python', 'MongoDB', 'REST APIs', 'Git'],
        applicantsCount: 118,
      }),
      createInternshipRole({
        id: 'proton-healthcare-app',
        track: 'app',
        companyName: 'Proton',
        designation: 'Trainee Software Engineer – App Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['Healthcare', 'Insurance'],
        description:
          'As a Trainee Software Engineer – App Development Intern at Proton, candidates will participate in designing, developing, testing, and maintaining mobile applications for Android and cross-platform environments.',
        keyDeliverables: [
          'Develop mobile health interfaces for vital tracking, doctor video consult booking, and policy cards.',
          'Integrate camera document scanning for medical bills/prescriptions and offline-first medication reminders.',
          'Implement patient authentication, secure session handling, and push notifications for health alerts.',
        ],
        techStack: ['Kotlin / Java', 'Flutter', 'Android Studio', 'Room DB', 'CameraX', 'REST APIs', 'Git'],
        applicantsCount: 112,
      }),
    ],
  },
  {
    id: 'ady-nexes',
    name: 'Ady Nexes',
    slug: 'ady-nexes',
    domain: 'Enterprise Cloud & AI',
    domainSlug: 'enterprise-ai',
    domainCategory: 'enterprise',
    assignedDomains: ['ERP/CRM', 'Loan'],
    assignedDomainSlugs: ['erp-crm', 'loan'],
    tagline: 'Multi-tenant enterprise SaaS, CRM pipelines & loan management systems',
    location: '100% Online Remote',
    rating: '4.9',
    hiringBatch: 'Batch 2026 / 2027',
    gradient: 'from-purple-600 via-violet-600 to-indigo-700',
    accentBorder: 'border-purple-500/30 hover:border-purple-500',
    badgeTint: 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
    logoBg: 'bg-purple-600',
    logoInitials: 'AN',
    stats: {
      teamSize: '320+ Platform Developers',
      placementAssistance: 'Placement Support',
      mentors: 'Principal Enterprise Engineers',
    },
    roles: [
      createInternshipRole({
        id: 'ady-nexes-enterprise-ai',
        track: 'web',
        companyName: 'Ady Nexes',
        designation: 'Trainee Software Engineer – Web Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['ERP/CRM', 'Loan'],
        description:
          'As a Trainee Software Engineer – Web Development Intern at Ady Nexes, candidates will work on designing, developing, testing, and maintaining responsive web applications across ERP/CRM and Loan domains.',
        keyDeliverables: [
          'Develop responsive enterprise dashboards, CRM kanban lead funnels, and loan EMI calculation tools.',
          'Implement backend business logic, multi-tenant authentication, and RESTful APIs with relational databases.',
          'Build automated report generation, customer notification workflows, and administrative panels.',
        ],
        techStack: ['HTML5 / CSS3', 'JavaScript', 'React.js', 'Python / FastAPI', 'PostgreSQL', 'Docker', 'Git'],
        applicantsCount: 230,
      }),
      createInternshipRole({
        id: 'ady-nexes-mobile-app',
        track: 'app',
        companyName: 'Ady Nexes',
        designation: 'Trainee Software Engineer – App Development',
        roleTitle: 'Trainee Software Engineer',
        domains: ['ERP/CRM', 'Loan'],
        description:
          'As a Trainee Software Engineer – App Development Intern at Ady Nexes, candidates will participate in designing, developing, testing, and maintaining mobile applications for Android and cross-platform environments.',
        keyDeliverables: [
          'Design and build mobile apps for field agents with interactive EMI calculators and lead tracking.',
          'Implement offline draft synchronization with SQLite/Room and push notifications for assignment alerts.',
          'Integrate camera for KYC document capture, digital signature capture, and GPS location tagging.',
        ],
        techStack: ['Flutter / Dart', 'React Native', 'Android Studio', 'SQLite', 'Firebase', 'REST APIs', 'Git'],
        applicantsCount: 160,
      }),
    ],
  },
];

module.exports = {
  BASE_WEB_RESPONSIBILITIES,
  BASE_APP_RESPONSIBILITIES,
  BASE_WEB_SKILLS,
  BASE_APP_SKILLS,
  COLOR_THEMES,
  DEFAULT_PARTNER_COMPANIES,
  PRICING_DURATIONS,
  DEFAULT_DURATION_PRICES,
  DEFAULT_CONCESSION_PERCENT,
  buildDefaultPricing,
  createInternshipRole,
};
