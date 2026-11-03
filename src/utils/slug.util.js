/**
 * Slug helper — used for designations, domains, etc.
 * Matches the frontend's slugify from '@/shared/utils/helpers'.
 */
const slugifyLib = require('slugify');

function slugify(text) {
  return slugifyLib(text || '', { lower: true, strict: true, trim: true });
}

/**
 * Generate a unique slug within a collection (Prisma model).
 * Checks for existing slugs and appends -2, -3, etc. if needed.
 * @param {object} model - Prisma model (e.g., prisma.designation)
 * @param {string} name - base name to slugify
 * @param {string|null} excludeId - ID to exclude from duplicate check (for updates)
 * @returns {Promise<string>} unique slug
 */
async function uniqueSlug(model, name, excludeId = null) {
  const base = slugify(name) || 'item';
  let slug = base;
  let suffix = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { slug };
    if (excludeId) where.NOT = { id: excludeId };
    const existing = await model.findFirst({ where, select: { id: true } });
    if (!existing) break;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

module.exports = { slugify, uniqueSlug };
