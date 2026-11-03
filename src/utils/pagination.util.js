/**
 * Pagination and sorting utilities.
 * Matches the frontend's expected list shape: { items, page, limit, total }
 * and the ?page=1&limit=10&sort=createdAt:desc query params.
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Parse pagination params from req.query.
 * @param {object} query - req.query
 * @param {number} [defaultLimit=10]
 * @returns {{ page: number, limit: number, skip: number }}
 */
function parsePagination(query, defaultLimit = DEFAULT_LIMIT) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Parse sort param: ?sort=createdAt:desc → { field: 'createdAt', order: 'desc' }
 * @param {string} sortParam - e.g. "createdAt:desc"
 * @param {string} [defaultSort='createdAt:desc']
 * @param {string[]} [allowedFields] - whitelist of sortable field names
 * @returns {{ field: string, order: 'asc'|'desc' }}
 */
function parseSort(sortParam, defaultSort = 'createdAt:desc', allowedFields = []) {
  const raw = sortParam || defaultSort;
  const [field, direction] = raw.split(':');
  const order = direction === 'asc' ? 'asc' : 'desc';

  // If allowedFields is provided, validate the field name
  if (allowedFields.length > 0 && !allowedFields.includes(field)) {
    const [defaultField, defaultDir] = defaultSort.split(':');
    return { field: defaultField, order: defaultDir === 'asc' ? 'asc' : 'desc' };
  }

  return { field, order };
}

/**
 * Build a Prisma orderBy object from the sort param.
 * Supports dot notation for nested fields (e.g. "user.name:asc").
 */
function buildOrderBy(sortParam, defaultSort = 'createdAt:desc', allowedFields = []) {
  const { field, order } = parseSort(sortParam, defaultSort, allowedFields);

  // Handle nested fields (e.g., "designation.name" -> { designation: { name: order } })
  const parts = field.split('.');
  if (parts.length === 1) {
    return { [field]: order };
  }
  // Build nested object
  let orderBy = { [parts[parts.length - 1]]: order };
  for (let i = parts.length - 2; i >= 0; i--) {
    orderBy = { [parts[i]]: orderBy };
  }
  return orderBy;
}

/**
 * Wrap query results in the standard list envelope.
 * @param {Array} items - result items
 * @param {number} total - total count (before pagination)
 * @param {number} page - current page
 * @param {number} limit - items per page
 * @returns {{ items, page, limit, total }}
 */
function paginatedResponse(items, total, page, limit) {
  return { items, page, limit, total };
}

/**
 * Build a Prisma `where` clause fragment for case-insensitive search across multiple fields.
 * @param {string|null} search - search term
 * @param {string[]} fields - field names to search in
 * @returns {object|undefined} - Prisma OR clause or undefined if no search
 */
function buildSearchFilter(search, fields) {
  if (!search || !search.trim()) return undefined;
  const term = search.trim();
  return {
    OR: fields.map((field) => {
      // Handle nested fields (e.g., "user.name")
      const parts = field.split('.');
      if (parts.length === 1) {
        return { [field]: { contains: term, mode: 'insensitive' } };
      }
      let clause = { [parts[parts.length - 1]]: { contains: term, mode: 'insensitive' } };
      for (let i = parts.length - 2; i >= 0; i--) {
        clause = { [parts[i]]: clause };
      }
      return clause;
    }),
  };
}

/**
 * Build a date range filter for Prisma.
 * @param {string|null} from - ISO date string (inclusive)
 * @param {string|null} to - ISO date string (inclusive)
 * @param {string} [field='createdAt']
 * @returns {object|undefined}
 */
function buildDateRangeFilter(from, to, field = 'createdAt') {
  if (!from && !to) return undefined;
  const filter = {};
  if (from) filter.gte = new Date(from);
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    filter.lte = toDate;
  }
  return { [field]: filter };
}

module.exports = {
  parsePagination,
  parseSort,
  buildOrderBy,
  paginatedResponse,
  buildSearchFilter,
  buildDateRangeFilter,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
