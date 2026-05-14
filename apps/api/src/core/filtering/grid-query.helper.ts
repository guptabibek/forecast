import type { AllowedFields } from './filter.types';
import { buildPrismaFilterAnd, buildPrismaOrderBy, parseFiltersParam } from './filter.util';

export interface GridQueryParams {
  page?: number | string;
  pageSize?: number | string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: string;
}

export interface GridResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GridQueryOptions {
  /** Static where conditions enforced on every query (e.g. tenantId, status) */
  baseWhere: Record<string, any>;
  /** Whitelist of fields that can be filtered/sorted */
  allowedFields: AllowedFields;
  /** Default sort, used when sortBy is missing or not in allowedFields */
  defaultOrderBy: Record<string, 'asc' | 'desc'>;
  /** Default page size when none supplied. Default 25. */
  defaultPageSize?: number;
  /** Hard upper bound on pageSize. Default 200. */
  maxPageSize?: number;
  /** Prisma include clause for relations */
  include?: any;
  /** Prisma select clause */
  select?: any;
}

/**
 * Run a filtered/sorted/paginated Prisma query in the standard ERP grid shape.
 * Returns `{ items, total, page, pageSize, totalPages }`.
 *
 * Usage:
 *   return applyGridQuery(this.prisma.bom, query, {
 *     baseWhere: { tenantId, ...(status && { status }) },
 *     allowedFields: BOM_ALLOWED_FIELDS,
 *     defaultOrderBy: { createdAt: 'desc' },
 *     include: { components: true },
 *   });
 */
export async function applyGridQuery<T>(
  model: {
    findMany: (args: any) => Promise<T[]>;
    count: (args: any) => Promise<number>;
  },
  query: GridQueryParams | undefined,
  options: GridQueryOptions,
): Promise<GridResult<T>> {
  const defaultPageSize = options.defaultPageSize ?? 25;
  const maxPageSize = options.maxPageSize ?? 200;

  const page = Math.max(1, Number(query?.page) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number(query?.pageSize) || defaultPageSize));

  const filters = parseFiltersParam(query?.filters);
  const filterAnd = buildPrismaFilterAnd(filters, options.allowedFields);

  const where = filterAnd.length
    ? { AND: [options.baseWhere, ...filterAnd] }
    : options.baseWhere;

  const orderBy = buildPrismaOrderBy(query?.sortBy, query?.sortDir, options.allowedFields, options.defaultOrderBy);

  const findArgs: any = {
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
  if (options.include) findArgs.include = options.include;
  if (options.select) findArgs.select = options.select;

  const [items, total] = await Promise.all([
    model.findMany(findArgs),
    model.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
