import { Injectable } from '@nestjs/common';
import { AiReportingBadRequest } from './ai-reporting.errors';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { CompiledSql } from './semantic-query.types';

const FORBIDDEN_SQL = /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|copy|vacuum|analyze|refresh|call|execute)\b/i;
const SYSTEM_TABLES = /\b(pg_catalog|information_schema|pg_|sqlite_|mysql\.)/i;
const DANGEROUS_FUNCTIONS = /\b(pg_sleep|dblink|lo_import|lo_export|copy_to|copy_from)\b/i;

@Injectable()
export class SqlSafetyValidator {
  constructor(private readonly catalog: SemanticCatalogLoader) {}

  validate(compiled: CompiledSql) {
    const sql = compiled.sql.trim();
    if (!/^select\b/i.test(sql)) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Compiled query must start with SELECT');
    }
    if (sql.includes(';')) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Compiled query must not contain semicolons');
    }
    if (FORBIDDEN_SQL.test(sql) || SYSTEM_TABLES.test(sql) || DANGEROUS_FUNCTIONS.test(sql)) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Compiled query contains a disallowed SQL construct');
    }
    if (!/\blimit\s+\$\d+\b/i.test(sql)) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Compiled query must use a parameterized LIMIT');
    }

    const allowedViews = new Set(this.catalog.getCatalog().datasets.filter((d) => d.allowedForNlq).map((d) => d.viewName));
    const viewMatches = [...sql.matchAll(/\bfrom\s+([a-z][a-z0-9_]*)\b/gi)].map((m) => m[1]);
    if (!viewMatches.length || viewMatches.some((view) => !allowedViews.has(view))) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Compiled query references an unapproved dataset');
    }

    if (!compiled.appliedSecurityFilters.includes('tenant_id')) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Compiled query is missing tenant security filter');
    }
    if (compiled.appliedSecurityFilters.includes('company_id') && !/\bcompany_id\s*=\s*any\(\$\d+::int\[\]\)/i.test(sql)) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Company security filter was not compiled safely');
    }
    if (
      (compiled.appliedSecurityFilters.includes('branch_id') || compiled.appliedSecurityFilters.includes('warehouse_id')) &&
      !/\b(branch_id|warehouse_id)\s*=\s*any\(\$\d+::uuid\[\]\)/i.test(sql)
    ) {
      throw new AiReportingBadRequest('UNSAFE_SQL', 'Branch security filter was not compiled safely');
    }
  }
}
