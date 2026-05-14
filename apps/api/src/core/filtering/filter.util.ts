import { BadRequestException } from '@nestjs/common';
import type { AllowedFields, FilterDescriptor, FilterOperator } from './filter.types';

const ALLOWED_OPERATORS = new Set<FilterOperator>([
  'contains', 'startsWith', 'endsWith',
  'equals', 'notEquals',
  'gt', 'gte', 'lt', 'lte',
  'between',
  'in', 'notIn',
  'isNull', 'isNotNull',
]);

/**
 * Parse the `filters` query param (JSON string) into a FilterDescriptor array.
 * Throws a 400 if the JSON is malformed.
 */
export function parseFiltersParam(raw: string | undefined): FilterDescriptor[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new BadRequestException('filters must be a valid JSON array');
  }
}

/**
 * Build an array of individual Prisma WHERE conditions from the filter descriptors.
 * Spread them into an AND clause alongside your fixed tenant/status conditions:
 *
 *   const filterAnd = buildPrismaFilterAnd(filters, ALLOWED_FIELDS);
 *   const where = filterAnd.length
 *     ? { AND: [{ tenantId, ...baseConditions }, ...filterAnd] }
 *     : { tenantId, ...baseConditions };
 */
export function buildPrismaFilterAnd(
  filters: FilterDescriptor[],
  allowedFields: AllowedFields,
): Record<string, unknown>[] {
  if (!filters?.length) return [];

  const conditions: Record<string, unknown>[] = [];

  for (const { field, operator, value } of filters) {
    if (!allowedFields[field]) {
      throw new BadRequestException(`Filtering on field '${field}' is not permitted`);
    }
    if (!ALLOWED_OPERATORS.has(operator)) {
      throw new BadRequestException(`Filter operator '${operator}' is not allowed`);
    }

    const fieldType = allowedFields[field];
    const cond = buildCondition(field, operator, value, fieldType);
    if (cond) conditions.push(cond);
  }

  return conditions;
}

/**
 * Build a Prisma `orderBy` object, falling back to `fallback` when the
 * requested sortBy is absent or not in the allowed fields whitelist.
 */
export function buildPrismaOrderBy(
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc' | undefined,
  allowedFields: AllowedFields,
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (sortBy && allowedFields[sortBy]) {
    return { [sortBy]: sortDir ?? 'asc' };
  }
  return fallback;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function coerce(value: unknown, fieldType: string): unknown {
  if (value === null || value === undefined) return value;
  switch (fieldType) {
    case 'number': {
      const n = Number(value);
      if (isNaN(n)) throw new BadRequestException(`Invalid number: ${value}`);
      return n;
    }
    case 'date': {
      const d = new Date(value as string);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
      return d;
    }
    case 'boolean':
      return value === 'true' || value === true;
    default:
      return String(value);
  }
}

function buildCondition(
  field: string,
  op: FilterOperator,
  value: unknown,
  fieldType: string,
): Record<string, unknown> | null {
  switch (op) {
    case 'isNull':
      return { [field]: null };
    case 'isNotNull':
      return { [field]: { not: null } };
    case 'contains':
      return { [field]: { contains: String(value ?? ''), mode: 'insensitive' } };
    case 'startsWith':
      return { [field]: { startsWith: String(value ?? ''), mode: 'insensitive' } };
    case 'endsWith':
      return { [field]: { endsWith: String(value ?? ''), mode: 'insensitive' } };
    case 'equals':
      return { [field]: { equals: coerce(value, fieldType) } };
    case 'notEquals':
      return { [field]: { not: coerce(value, fieldType) } };
    case 'gt':
      return { [field]: { gt: coerce(value, fieldType) } };
    case 'gte':
      return { [field]: { gte: coerce(value, fieldType) } };
    case 'lt':
      return { [field]: { lt: coerce(value, fieldType) } };
    case 'lte':
      return { [field]: { lte: coerce(value, fieldType) } };
    case 'between': {
      const [from, to] = Array.isArray(value) ? value : [value, value];
      return {
        [field]: {
          gte: coerce(from, fieldType),
          lte: coerce(to, fieldType),
        },
      };
    }
    case 'in': {
      const vals = (Array.isArray(value) ? value : [value]).map((v) => coerce(v, fieldType));
      return { [field]: { in: vals } };
    }
    case 'notIn': {
      const vals = (Array.isArray(value) ? value : [value]).map((v) => coerce(v, fieldType));
      return { [field]: { notIn: vals } };
    }
    default:
      return null;
  }
}
