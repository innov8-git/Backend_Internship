const { InternshipsService } = require('../../modules/internships/services/internships.service');

describe('InternshipsService (SOLID & DRY)', () => {
  beforeEach(async () => {
    await InternshipsService.resetToDefaults();
  });

  it('should list all baseline partner internship positions and calculate stats', () => {
    const result = InternshipsService.listPositions();
    expect(result).toBeDefined();
    expect(result.items.length).toBe(8); // 4 companies x 2 tracks
    expect(result.companies.length).toBe(4);
    expect(result.stats.totalPositions).toBe(8);
    expect(result.stats.webPositions).toBe(4);
    expect(result.stats.appPositions).toBe(4);
  });

  it('should filter positions by track', () => {
    const webOnly = InternshipsService.listPositions({ track: 'web' });
    expect(webOnly.items.length).toBe(4);
    expect(webOnly.items.every((p) => p.role.track === 'web')).toBe(true);

    const appOnly = InternshipsService.listPositions({ track: 'app' });
    expect(appOnly.items.length).toBe(4);
    expect(appOnly.items.every((p) => p.role.track === 'app')).toBe(true);
  });

  it('should filter positions by domain', () => {
    const bankingPositions = InternshipsService.listPositions({ domain: 'Banking' });
    expect(bankingPositions.items.length).toBeGreaterThan(0);
    expect(
      bankingPositions.items.every(
        (p) =>
          p.partner.domain.includes('Banking') ||
          p.partner.assignedDomains?.includes('Banking') ||
          p.role.domains?.includes('Banking'),
      ),
    ).toBe(true);
  });

  it('should find position by role ID', () => {
    const pos = InternshipsService.getPositionById('inlarge-fintech-eng');
    expect(pos).toBeDefined();
    expect(pos.role.id).toBe('inlarge-fintech-eng');
    expect(pos.partner.name).toBe('Inlarge Software');
  });

  it('should create a new internship position cleanly', async () => {
    const newPosition = {
      companyName: 'Apex Cloud Innovations',
      track: 'web',
      role: 'Cloud Software Engineer',
      designation: 'Cloud Software Engineer – Web Systems',
      assignedDomains: ['ERP/CRM', 'Cloud'],
      themeColor: 'cyan',
      applicantsCount: 75,
    };

    const created = await InternshipsService.savePosition(newPosition, null);
    expect(created.role).toBeDefined();
    expect(created.role.role).toBe('Cloud Software Engineer');
    expect(created.partner.name).toBe('Apex Cloud Innovations');

    const listed = InternshipsService.listPositions({ search: 'Apex Cloud' });
    expect(listed.items.length).toBe(1);
    expect(listed.stats.totalPositions).toBe(9);
  });

  it('should update an existing position', async () => {
    const updated = await InternshipsService.savePosition(
      {
        companyName: 'Inlarge Software',
        track: 'web',
        role: 'Senior Trainee Software Engineer',
        applicantsCount: 200,
        assignedDomains: ['Banking', 'Finance'],
      },
      'inlarge-fintech-eng',
    );

    expect(updated.role.role).toBe('Senior Trainee Software Engineer');
    expect(updated.role.applicantsCount).toBe(200);

    const pos = InternshipsService.getPositionById('inlarge-fintech-eng');
    expect(pos.role.role).toBe('Senior Trainee Software Engineer');
  });

  it('should delete a position and allow reset to defaults', async () => {
    await InternshipsService.deletePosition('inlarge-fintech-eng');
    const afterDelete = InternshipsService.listPositions();
    expect(afterDelete.stats.totalPositions).toBe(7);

    await InternshipsService.resetToDefaults();
    const afterReset = InternshipsService.listPositions();
    expect(afterReset.stats.totalPositions).toBe(8);
  });

  it('should resolve dynamic pricing by company, domain, and duration (1, 2, 3, 6)', async () => {
    await InternshipsService.savePosition(
      {
        companyName: 'Inlarge Software',
        track: 'web',
        role: 'Trainee Software Engineer',
        assignedDomains: ['Banking', 'Finance'],
        pricing: {
          concessionPercent: 20,
          defaultPrices: { 1: 1000, 2: 1500, 3: 2000, 6: 3500 },
          domainPrices: {
            Banking: { 1: 1200, 2: 1800, 3: 2500, 6: 4000 },
            Finance: { 1: 1500, 2: 2000, 3: 3000, 6: 5000 },
          },
        },
      },
      'inlarge-fintech-eng',
    );

    const banking3m = InternshipsService.getQuote({
      internshipId: 'inlarge-fintech-eng',
      domainName: 'Banking',
      durationMonths: 3,
    });
    expect(banking3m.basePrice).toBe(2500);
    expect(banking3m.concessionPercent).toBe(20);
    expect(banking3m.discountAmount).toBe(500);
    expect(banking3m.payableAmount).toBe(2000);
    expect(banking3m.payablePaise).toBe(200000);

    const finance6m = InternshipsService.getQuote({
      internshipId: 'inlarge-fintech-eng',
      domainName: 'Finance',
      durationMonths: '6 Months',
    });
    expect(finance6m.basePrice).toBe(5000);
    expect(finance6m.discountAmount).toBe(1000);
    expect(finance6m.payableAmount).toBe(4000);
    expect(finance6m.payablePaise).toBe(400000);
  });

  it('should persist and clear company logoUrl when creating or updating a position', async () => {
    const created = await InternshipsService.savePosition({
      companyName: 'Logo Corp',
      logoUrl: '/uploads/logo-corp.png',
      track: 'web',
      role: 'Trainee Software Engineer',
      assignedDomains: ['Banking'],
    });
    const fetchedCreated = InternshipsService.getPositionById(created.role.id);
    expect(fetchedCreated.partner.logoUrl).toBe('/uploads/logo-corp.png');

    await InternshipsService.savePosition(
      {
        companyName: 'Logo Corp',
        logoUrl: '',
        track: 'web',
        role: 'Trainee Software Engineer',
        assignedDomains: ['Banking'],
      },
      created.role.id,
    );
    const fetchedUpdated = InternshipsService.getPositionById(created.role.id);
    expect(fetchedUpdated.partner.logoUrl).toBeUndefined();
  });

  it('should resolve project-wise duration pricing within a domain and fall back to domain pricing', async () => {
    await InternshipsService.savePosition(
      {
        companyName: 'Inlarge Software',
        track: 'web',
        role: 'Trainee Software Engineer',
        assignedDomains: ['Banking'],
        pricing: {
          concessionPercent: 10,
          defaultPrices: { 1: 999, 2: 1499, 3: 1999, 6: 2999 },
          domainPrices: {
            Banking: { 1: 1000, 2: 1500, 3: 2000, 6: 3000 },
          },
          projectPrices: {
            Banking: {
              'proj-apexpay': { 1: 1200, 2: 1800, 3: 2500, 6: 4000 },
            },
          },
        },
      },
      'inlarge-fintech-eng',
    );

    const customProjQuote = InternshipsService.getQuote({
      internshipId: 'inlarge-fintech-eng',
      domainName: 'Banking',
      projectId: 'proj-apexpay',
      durationMonths: 3,
    });
    expect(customProjQuote.basePrice).toBe(2500);
    expect(customProjQuote.discountAmount).toBe(250);
    expect(customProjQuote.payableAmount).toBe(2250);

    const fallbackProjQuote = InternshipsService.getQuote({
      internshipId: 'inlarge-fintech-eng',
      domainName: 'Banking',
      projectId: 'proj-other',
      durationMonths: 3,
    });
    expect(fallbackProjQuote.basePrice).toBe(2000);
    expect(fallbackProjQuote.discountAmount).toBe(200);
    expect(fallbackProjQuote.payableAmount).toBe(1800);
  });
});
