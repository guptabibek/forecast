// ============================================================================
// PHARMA-REPORTS COLUMN FILTER HELPER
//
// Pharma reports run hand-written SQL via Prisma.$queryRaw — Prisma's typed
// findMany/count helpers don't apply. This helper provides a SQL-injection-safe
// way to translate the standard ColumnFilter[] payload (`{field, operator, value}`)
// into Prisma.Sql fragments suitable for splicing into a raw query's WHERE clause
// and ORDER BY clause.
//
// Each report registers an `AllowedSqlColumns` map which binds a logical column
// name (as projected to the API consumer) to the *exact* SQL expression and the
// data type. Field names not in the allowlist are rejected.
// ============================================================================

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type PharmaFilterOperator =
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'isNull'
  | 'isNotNull';

export type PharmaFieldType = 'string' | 'number' | 'date' | 'boolean' | 'enum';

export interface PharmaColumnFilter {
  field: string;
  operator: PharmaFilterOperator;
  value?: unknown;
}

export interface PharmaColumnSpec {
  /** Raw SQL expression to apply the filter against, e.g. `p.code` or `COALESCE(il.on_hand_qty, 0)`. Must be authored by the developer; never user-supplied. */
  expression: string;
  type: PharmaFieldType;
}

export type AllowedSqlColumns = Record<string, PharmaColumnSpec>;

const ALLOWED_OPERATORS = new Set<PharmaFilterOperator>([
  'contains', 'startsWith', 'endsWith',
  'equals', 'notEquals',
  'gt', 'gte', 'lt', 'lte',
  'between',
  'in', 'notIn',
  'isNull', 'isNotNull',
]);

// ────────────────────────────────────────────────────────────────────────────
// Parse the JSON filters query param.
// ────────────────────────────────────────────────────────────────────────────
export function parsePharmaFilters(raw: string | undefined | null): PharmaColumnFilter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new BadRequestException('filters must be a valid JSON array');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Build an array of Prisma.Sql WHERE conditions from ColumnFilter[].
// Returns conditions to be ANDed alongside the report's existing baseWhere.
// ────────────────────────────────────────────────────────────────────────────
export function buildPharmaFilterSql(
  filters: PharmaColumnFilter[],
  allowed: AllowedSqlColumns,
): Prisma.Sql[] {
  if (!filters?.length) return [];

  const conditions: Prisma.Sql[] = [];

  for (const { field, operator, value } of filters) {
    const spec = allowed[field];
    if (!spec) {
      throw new BadRequestException(`Filtering on column '${field}' is not permitted`);
    }
    if (!ALLOWED_OPERATORS.has(operator)) {
      throw new BadRequestException(`Filter operator '${operator}' is not allowed`);
    }

    const expr = Prisma.raw(spec.expression);
    const cond = buildCondition(expr, operator, value, spec.type);
    if (cond) conditions.push(cond);
  }

  return conditions;
}

// ────────────────────────────────────────────────────────────────────────────
// Build a Prisma.Sql ORDER BY clause from sortBy/sortDir + allowlist.
// Falls back to `defaultOrderBy` (a Prisma.Sql) when sortBy is invalid/missing.
// ────────────────────────────────────────────────────────────────────────────
export function buildPharmaOrderBySql(
  sortBy: string | undefined | null,
  sortDir: 'asc' | 'desc' | undefined | null,
  allowed: AllowedSqlColumns,
  defaultOrderBy: Prisma.Sql,
): Prisma.Sql {
  if (!sortBy) return defaultOrderBy;
  const spec = allowed[sortBy];
  if (!spec) return defaultOrderBy;
  const dir = sortDir === 'desc' ? Prisma.sql`DESC NULLS LAST` : Prisma.sql`ASC NULLS LAST`;
  return Prisma.sql`${Prisma.raw(spec.expression)} ${dir}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: AND together a base WHERE with an extra Prisma.Sql[] of conditions.
// Re-exported to keep callers consistent (they already have a similar private
// helper) — using this version eliminates duplication.
// ────────────────────────────────────────────────────────────────────────────
export function joinAnd(base: Prisma.Sql, extra: Prisma.Sql[]): Prisma.Sql {
  if (!extra.length) return base;
  return Prisma.sql`${base} AND ${Prisma.join(extra, ' AND ')}`;
}

// ── Private helpers ────────────────────────────────────────────────────────
function coerce(value: unknown, type: PharmaFieldType): unknown {
  if (value === null || value === undefined) return value;
  switch (type) {
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
  expr: Prisma.Sql,
  op: PharmaFilterOperator,
  value: unknown,
  type: PharmaFieldType,
): Prisma.Sql | null {
  switch (op) {
    case 'isNull':
      return Prisma.sql`${expr} IS NULL`;
    case 'isNotNull':
      return Prisma.sql`${expr} IS NOT NULL`;
    case 'contains':
      return Prisma.sql`${expr}::text ILIKE ${'%' + String(value ?? '') + '%'}`;
    case 'startsWith':
      return Prisma.sql`${expr}::text ILIKE ${String(value ?? '') + '%'}`;
    case 'endsWith':
      return Prisma.sql`${expr}::text ILIKE ${'%' + String(value ?? '')}`;
    case 'equals': {
      const v = coerce(value, type);
      if (type === 'string' || type === 'enum') {
        return Prisma.sql`${expr}::text = ${v}`;
      }
      return Prisma.sql`${expr} = ${v}`;
    }
    case 'notEquals': {
      const v = coerce(value, type);
      if (type === 'string' || type === 'enum') {
        return Prisma.sql`${expr}::text <> ${v}`;
      }
      return Prisma.sql`${expr} <> ${v}`;
    }
    case 'gt':  return Prisma.sql`${expr} >  ${coerce(value, type)}`;
    case 'gte': return Prisma.sql`${expr} >= ${coerce(value, type)}`;
    case 'lt':  return Prisma.sql`${expr} <  ${coerce(value, type)}`;
    case 'lte': return Prisma.sql`${expr} <= ${coerce(value, type)}`;
    case 'between': {
      const [from, to] = Array.isArray(value) ? value : [value, value];
      return Prisma.sql`${expr} BETWEEN ${coerce(from, type)} AND ${coerce(to, type)}`;
    }
    case 'in': {
      const vals = (Array.isArray(value) ? value : [value]).map((v) => coerce(v, type));
      if (!vals.length) return null;
      if (type === 'string' || type === 'enum') {
        return Prisma.sql`${expr}::text IN (${Prisma.join(vals)})`;
      }
      return Prisma.sql`${expr} IN (${Prisma.join(vals)})`;
    }
    case 'notIn': {
      const vals = (Array.isArray(value) ? value : [value]).map((v) => coerce(v, type));
      if (!vals.length) return null;
      if (type === 'string' || type === 'enum') {
        return Prisma.sql`${expr}::text NOT IN (${Prisma.join(vals)})`;
      }
      return Prisma.sql`${expr} NOT IN (${Prisma.join(vals)})`;
    }
    default:
      return null;
  }
}
