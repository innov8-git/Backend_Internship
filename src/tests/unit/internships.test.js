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
});
