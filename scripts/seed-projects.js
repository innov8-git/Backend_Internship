'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DESIGNATIONS = [
  {
    name: 'Java Developer',
    slug: 'java-developer',
    description:
      'Build and maintain backend services with Java 17 and Spring Boot the way enterprise teams do. You start by debugging, merging and reviewing code in an existing repository, then design REST APIs, JPA persistence, transactions, logging and automated tests.',
    status: 'PUBLISHED',
  },
  {
    name: 'Full Stack Developer',
    slug: 'full-stack-developer',
    description:
      'Ship complete features across a React front end and a Node.js and Express API backed by MongoDB. You build responsive interfaces, REST endpoints, authentication and checkout flows, and learn to debug across the browser, the network and the server.',
    status: 'PUBLISHED',
  },
  {
    name: '.NET Developer',
    slug: 'dotnet-developer',
    description:
      'Build secure, well-tested web APIs with C#, ASP.NET Core and Entity Framework Core. You work with dependency injection, middleware, LINQ, async code and database migrations, and cover your work with xUnit tests.',
    status: 'PUBLISHED',
  },
  {
    name: 'DevOps Engineer',
    slug: 'devops-engineer',
    description:
      'Automate how software is built, shipped and run in production. You write CI/CD pipelines, package services with Docker, deploy them to Kubernetes, manage infrastructure with Terraform and set up monitoring and alerts.',
    status: 'PUBLISHED',
  },
];

const DOMAINS = [
  {
    name: 'Banking',
    slug: 'banking',
    description:
      'Accounts, fund transfers, ledgers and statements for a retail bank, where correctness, auditability and safe transaction handling come first.',
    status: 'PUBLISHED',
  },
  {
    name: 'Healthcare',
    slug: 'healthcare',
    description:
      'Appointments, patient records and clinical workflows for a chain of clinics, built with strict privacy rules and role-based access to sensitive data.',
    status: 'PUBLISHED',
  },
  {
    name: 'Telecom',
    slug: 'telecom',
    description:
      'Usage rating, billing and subscriber services for a mobile operator that processes millions of call and data records every day and must stay available around the clock.',
    status: 'PUBLISHED',
  },
  {
    name: 'E-commerce',
    slug: 'e-commerce',
    description:
      'Product catalogues, carts, checkout, payments and order tracking for an online store, where speed and reliability directly affect revenue.',
    status: 'PUBLISHED',
  },
  {
    name: 'Insurance',
    slug: 'insurance',
    description:
      'Policy administration, premium calculation and claims processing for a general insurer, with a clear audit trail for every decision.',
    status: 'PUBLISHED',
  },
];

const BASE_PRICES = {
  1: 499900,
  2: 899900,
  3: 1299900,
  4: 1599900,
  6: 2199900,
};

const SEED_PROJECTS = [
  {
    title: 'LedgerCore — Retail Banking & Fund Transfer Engine',
    slug: 'ledgercore-banking',
    domainSlug: 'banking',
    starterRepoUrl: 'https://github.com/internship-portal/java-banking-starter',
    appStarterRepoUrl: 'https://github.com/internship-portal/mobile-banking-starter',
    technologies: ['React.js', 'Next.js', 'Tailwind CSS', 'TypeScript', 'Axios', 'Chart.js'],
    webTechStack: ['React.js', 'Next.js', 'Tailwind CSS', 'TypeScript', 'Axios', 'Chart.js'],
    webDeliverables:
      'Responsive customer web portal with real-time multi-account dashboard, fund transfer forms with 2-step OTP confirmation, downloadable PDF statements, and spending analytics charts.',
    appTechStack: ['React Native', 'Expo', 'Redux Toolkit', 'Biometric Auth', 'Axios'],
    appDeliverables:
      'Cross-platform mobile banking app featuring fingerprint/FaceID login, instant UPI and P2P transfers, balance inquiry cards, and real-time push transaction alerts.',
    durationsSupported: [1, 2, 3, 6],
    isDefault: true,
    status: 'PUBLISHED',
    description:
      'Enterprise retail banking and core fund transfer platform supporting multi-account management, atomic double-entry bookkeeping, real-time balance calculations, audit logs, and fraud detection flags.',
  },
  {
    title: 'ApexPay — Digital UPI & Merchant Settlement Platform',
    slug: 'apexpay-merchant-platform',
    domainSlug: 'banking',
    starterRepoUrl: 'https://github.com/internship-portal/apexpay-starter',
    appStarterRepoUrl: 'https://github.com/internship-portal/apexpay-mobile-starter',
    technologies: ['React.js', 'TypeScript', 'Tailwind CSS', 'AG Grid', 'Socket.io', 'Axios'],
    webTechStack: ['React.js', 'TypeScript', 'Tailwind CSS', 'AG Grid', 'Socket.io', 'Axios'],
    webDeliverables:
      'Merchant web dashboard with real-time transaction ticker, payment link generator, daily settlement payout schedules, and chargeback dispute management.',
    appTechStack: ['Flutter', 'Dart', 'Provider', 'QR Code Scanner Plugin', 'Local Auth'],
    appDeliverables:
      'Merchant soundbox companion mobile app with live audio payment alerts, dynamic QR code billing, offline transaction caching, and daily collection reports.',
    durationsSupported: [1, 2, 3, 6],
    isDefault: false,
    status: 'PUBLISHED',
    description:
      'High-throughput digital payment processing gateway handling instant UPI QR collections, batch merchant payouts, settlement disputes, and real-time ledger reconciliation.',
  },
  {
    title: 'MediCare360 — Patient EHR & Teleconsultation Suite',
    slug: 'medicare360-ehr',
    domainSlug: 'healthcare',
    starterRepoUrl: 'https://github.com/internship-portal/medicare-starter',
    appStarterRepoUrl: 'https://github.com/internship-portal/medicare-app-starter',
    technologies: ['React.js', 'Node.js', 'Tailwind CSS', 'WebRTC', 'PostgreSQL'],
    webTechStack: ['React.js', 'Tailwind CSS', 'TypeScript', 'WebRTC Video SDK'],
    webDeliverables:
      'Clinical web console with doctor schedule management, EHR timeline view, digital prescription builder, and browser-based encrypted video consultations.',
    appTechStack: ['React Native', 'Expo', 'Push Notifications', 'Camera API'],
    appDeliverables:
      'Patient mobile companion app for booking specialist appointments, downloading lab reports, medicine reminders, and biometric SOS triage.',
    durationsSupported: [1, 2, 3, 6],
    isDefault: true,
    status: 'PUBLISHED',
    description:
      'HIPAA-compliant Electronic Health Records (EHR) and telemedicine platform enabling clinic appointment booking, encrypted video triage, lab reports, and medication reminders.',
  },
  {
    title: 'PulseTel — Real-Time Telecom Billing & Usage Analytics',
    slug: 'pulsetel-billing-analytics',
    domainSlug: 'telecom',
    starterRepoUrl: 'https://github.com/internship-portal/pulsetel-starter',
    appStarterRepoUrl: 'https://github.com/internship-portal/pulsetel-app-starter',
    technologies: ['Vue.js', 'Node.js', 'Apache Kafka', 'Redis', 'Tailwind CSS'],
    webTechStack: ['React.js', 'Tailwind CSS', 'D3.js Charts', 'Server-Sent Events'],
    webDeliverables:
      'Self-care subscriber portal for real-time 5G data quota tracking, dynamic plan recharge, CDR call detail records, and automated invoice PDF generation.',
    appTechStack: ['React Native', 'Native Base', 'Razorpay SDK'],
    appDeliverables:
      'Subscriber mobile app with one-tap eSIM activation, instant recharge, international roaming toggles, and live data usage widgets.',
    durationsSupported: [1, 2, 3, 6],
    isDefault: true,
    status: 'PUBLISHED',
    description:
      'High-speed telecom billing and rating engine tracking call detail records (CDRs), dynamic tariff plans, real-time data threshold alerts, and automated bill generation.',
  },
  {
    title: 'CartPulse — Multi-Vendor E-Commerce & Logistics Hub',
    slug: 'cartpulse-ecommerce',
    domainSlug: 'e-commerce',
    starterRepoUrl: 'https://github.com/internship-portal/cartpulse-starter',
    appStarterRepoUrl: 'https://github.com/internship-portal/cartpulse-app-starter',
    technologies: ['Next.js', 'Tailwind CSS', 'Redux Toolkit', 'Stripe', 'Node.js'],
    webTechStack: ['Next.js', 'Tailwind CSS', 'Zustand', 'Stripe Elements'],
    webDeliverables:
      'Modern customer storefront with elastic product search, faceted filters, real-time stock reservations, multi-vendor cart, and checkout flow.',
    appTechStack: ['Flutter', 'Dart', 'Google Maps SDK', 'Firebase Cloud Messaging'],
    appDeliverables:
      'Customer and delivery rider mobile apps with live GPS order tracking, OTP delivery confirmation, and order status notifications.',
    durationsSupported: [1, 2, 3, 6],
    isDefault: true,
    status: 'PUBLISHED',
    description:
      'Scalable multi-tenant e-commerce platform with flash-sale inventory reservation, multi-currency payment checkout, order fulfillment tracking, and seller analytics.',
  },
];

async function seedAll() {
  console.log('🌱 Starting comprehensive Catalog, Domains, Plans & Projects seeding...');

  // 1. Seed Designations
  console.log('1. Seeding Designations...');
  const designationRecords = [];
  for (const des of DESIGNATIONS) {
    const record = await prisma.designation.upsert({
      where: { slug: des.slug },
      update: { name: des.name, description: des.description, status: des.status },
      create: des,
    });
    designationRecords.push(record);
    console.log(`   ✓ Designation: ${des.name}`);
  }

  // 2. Seed Domains
  console.log('2. Seeding Domains...');
  const domainRecords = [];
  for (const dom of DOMAINS) {
    const record = await prisma.domain.upsert({
      where: { slug: dom.slug },
      update: { name: dom.name, description: dom.description, status: dom.status },
      create: dom,
    });
    domainRecords.push(record);
    console.log(`   ✓ Domain: ${dom.name}`);
  }

  // 3. Seed Internship Plans & Pricing
  console.log('3. Seeding Internship Plans & Pricing...');
  const primaryDesignation = designationRecords[0];
  for (const dom of domainRecords) {
    for (const [duration, price] of Object.entries(BASE_PRICES)) {
      await prisma.internshipPlan.upsert({
        where: {
          designationId_domainId_durationMonths: {
            designationId: primaryDesignation.id,
            domainId: dom.id,
            durationMonths: Number(duration),
          },
        },
        update: {
          basePrice: price,
          status: 'PUBLISHED',
        },
        create: {
          designationId: primaryDesignation.id,
          domainId: dom.id,
          durationMonths: Number(duration),
          basePrice: price,
          currency: 'INR',
          status: 'PUBLISHED',
        },
      });
    }
    console.log(`   ✓ Plans created for ${dom.name} (${Object.keys(BASE_PRICES).length} duration tiers)`);
  }

  // 4. Seed Projects
  console.log('4. Seeding Domain Capstone Projects...');
  const domainMap = new Map(domainRecords.map((d) => [d.slug.toLowerCase(), d]));

  for (const proj of SEED_PROJECTS) {
    const domain = domainMap.get(proj.domainSlug.toLowerCase());
    if (!domain) continue;

    const projectData = {
      title: proj.title,
      slug: proj.slug,
      domainId: domain.id,
      designationId: primaryDesignation.id,
      starterRepoUrl: proj.starterRepoUrl,
      appStarterRepoUrl: proj.appStarterRepoUrl,
      technologies: proj.technologies,
      webTechStack: proj.webTechStack,
      webDeliverables: proj.webDeliverables,
      appTechStack: proj.appTechStack,
      appDeliverables: proj.appDeliverables,
      durationsSupported: proj.durationsSupported,
      isDefault: proj.isDefault,
      status: proj.status,
      description: proj.description,
    };

    await prisma.project.upsert({
      where: { slug: proj.slug },
      update: projectData,
      create: projectData,
    });

    console.log(`   ✓ Project: ${proj.title}`);
  }

  // 5. Seed Domain Questions
  console.log('5. Seeding Domain Questions for Question Banks...');
  for (const dom of domainRecords) {
    const qCount = await prisma.domainQuestion.count({ where: { domainId: dom.id } });
    if (qCount === 0) {
      const questions = [
        {
          domainId: dom.id,
          text: `In a ${dom.name} system, what is the primary purpose of idempotent API design?`,
          options: [
            'To prevent duplicate processing of critical requests when retried',
            'To increase network transfer speeds',
            'To bypass authentication checks',
            'To compress database payloads',
          ],
          correctIndex: 0,
          explanation: 'Idempotency guarantees that multiple identical requests produce the same result without unintended side effects.',
        },
        {
          domainId: dom.id,
          text: `Which database transaction isolation level prevents dirty reads, non-repeatable reads, and phantom reads in ${dom.name} architectures?`,
          options: ['Read Uncommitted', 'Read Committed', 'Repeatable Read', 'Serializable'],
          correctIndex: 3,
          explanation: 'Serializable is the highest isolation level and completely prevents dirty reads, non-repeatable reads, and phantom reads.',
        },
        {
          domainId: dom.id,
          text: `When designing microservices for ${dom.name}, which pattern handles distributed data consistency across services without two-phase locking?`,
          options: ['Saga Pattern', 'Singleton Pattern', 'Decorator Pattern', 'Factory Pattern'],
          correctIndex: 0,
          explanation: 'The Saga pattern coordinates transactions across multiple microservices using a sequence of local transactions and compensating actions.',
        },
      ];

      for (const q of questions) {
        await prisma.domainQuestion.create({ data: q });
      }
      console.log(`   ✓ Seeded ${questions.length} questions for ${dom.name}`);
    }
  }

  console.log('✨ All entities (Designations, Domains, Plans/Pricing, Projects, Questions) seeded successfully!');
}

seedAll()
  .catch((err) => {
    console.error('❌ Seeding error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
