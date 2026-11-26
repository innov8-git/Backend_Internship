const fs = require('fs');
const path = require('path');
const { DEFAULT_PARTNER_COMPANIES } = require('./constants');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'partner-internships.json');

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_PARTNER_COMPANIES, null, 2), 'utf-8');
  }
}

function readAllCompanies() {
  try {
    ensureDataFile();
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Fallback to in-memory defaults
  }
  return clone(DEFAULT_PARTNER_COMPANIES);
}

function saveAllCompanies(companies) {
  ensureDataFile();
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(companies, null, 2), 'utf-8');
  fs.renameSync(tempFile, DATA_FILE);
  return companies;
}

function flattenPositions(companies) {
  const positions = [];
  companies.forEach((partner) => {
    const roles = Array.isArray(partner.roles) && partner.roles.length > 0
      ? partner.roles
      : partner.internship
        ? [partner.internship]
        : [];

    roles.forEach((role) => {
      positions.push({
        id: `${partner.id}-${role.id}`,
        partnerId: partner.id,
        roleId: role.id,
        partner,
        role,
      });
    });
  });
  return positions;
}

class InternshipsModel {
  static getCompanies() {
    return readAllCompanies();
  }

  static getPositions() {
    const companies = readAllCompanies();
    return flattenPositions(companies);
  }

  static findPositionById(positionOrRoleId) {
    const positions = this.getPositions();
    return positions.find(
      (p) =>
        p.id === positionOrRoleId ||
        p.roleId === positionOrRoleId ||
        p.role.id === positionOrRoleId,
    ) || null;
  }

  static saveCompanies(companies) {
    return saveAllCompanies(companies);
  }

  static resetToDefaults() {
    const defaults = clone(DEFAULT_PARTNER_COMPANIES);
    saveAllCompanies(defaults);
    return defaults;
  }
}

module.exports = {
  InternshipsModel,
  flattenPositions,
};
