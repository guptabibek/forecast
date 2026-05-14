import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  AllowedSqlColumns,
  buildPharmaFilterSql,
  buildPharmaOrderBySql,
  parsePharmaFilters,
} from '../pharma-filter.helper';

/**
 * Accounting Reports Service.
 *
 * Production-grade pharma-reports access to General Ledger artefacts (chart of
 * accounts, journal activity, trial balance). The trial balance algorithm is
 * a textbook double-entry summarisation:
 *
 *   - sum(debit) and sum(credit) for every active GL account, scoped to POSTED
 *     journal entries within an optional accounting window
 *   - net_balance = sum(debit) − sum(credit)
 *   - debit_balance / credit_balance presented per-account based on net sign,
 *     so totals can roll up cleanly (sum of debit balances = sum of credit
 *     balances when the ledger is balanced)
 *   - opening balance + period activity + closing balance, when a window is
 *     supplied, to support production audit/period-close workflows
 */

const TRIAL_BALANCE_COLUMNS: AllowedSqlColumns = {
  accountNumber: { expression: 'account_number', type: 'string' },
  name: { expression: 'name', type: 'string' },
  accountType: { expression: 'account_type', type: 'enum' },
  normalBalance: { expression: 'normal_balance', type: 'enum' },
  totalDebits: { expression: 'total_debits', type: 'number' },
  totalCredits: { expression: 'total_credits', type: 'number' },
  netBalance: { expression: 'net_balance', type: 'number' },
  openingBalance: { expression: 'opening_balance', type: 'number' },
  closingBalance: { expression: 'closing_balance', type: 'number' },
};

const ACCOUNT_LEDGER_COLUMNS: AllowedSqlColumns = {
  entryDate: { expression: 'entry_date', type: 'date' },
  entryNumber: { expression: 'entry_number', type: 'string' },
  description: { expression: 'description', type: 'string' },
  status: { expression: 'status', type: 'enum' },
  referenceType: { expression: 'reference_type', type: 'string' },
  debitAmount: { expression: 'debit_amount', type: 'number' },
  creditAmount: { expression: 'credit_amount', type: 'number' },
  runningBalance: { expression: 'running_balance', type: 'number' },
};

export interface TrialBalanceFilters {
  startDate?: string;
  endDate?: string;
  accountType?: string;
  showZero?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: string;
}

export interface AccountLedgerFilters {
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: string;
}

export interface TrialBalanceRow {
  id: string;
  accountNumber: string;
  name: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  netBalance: number;
  closingBalance: number;
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalanceResponse {
  rows: TrialBalanceRow[];
  total: number;
  summary: {
    accountsShown: number;
    totalDebits: number;
    totalCredits: number;
    sumDebitBalance: number;
    sumCreditBalance: number;
    netDifference: number;
    isBalanced: boolean;
  };
}

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTrialBalance(tenantId: string, filters: TrialBalanceFilters): Promise<TrialBalanceResponse> {
    // Trial balance is bounded by the chart-of-accounts size — pharma deployments
    // typically run 50-300 accounts. Cap generously so the Tally-style grouped
    // render can show every row without paginating (subtotals require all rows).
    const limit = Math.min(5000, Math.max(1, filters.limit ?? 5000));
    const offset = Math.max(0, filters.offset ?? 0);

    const startSql = filters.startDate ? Prisma.sql`${filters.startDate}::date` : Prisma.sql`NULL::date`;
    const endSql = filters.endDate ? Prisma.sql`${filters.endDate}::date` : Prisma.sql`NULL::date`;

    const accountTypeFilter = filters.accountType
      ? Prisma.sql`AND ga.account_type::text = ${filters.accountType}`
      : Prisma.empty;

    const detailFilterConds = buildPharmaFilterSql(parsePharmaFilters(filters.filters), TRIAL_BALANCE_COLUMNS);
    const detailWhere = detailFilterConds.length
      ? Prisma.sql`WHERE ${Prisma.join(detailFilterConds, ' AND ')}`
      : Prisma.empty;
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy,
      filters.sortDir,
      TRIAL_BALANCE_COLUMNS,
      Prisma.sql`account_number ASC`,
    );

    // Period activity (postings within window) and opening balance (postings strictly
    // before startDate). Both are computed in one CTE pass per account.
    const cte = Prisma.sql`
      WITH posted_lines AS (
        SELECT
          jl.gl_account_id,
          jl.debit_amount,
          jl.credit_amount,
          je.entry_date
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.tenant_id = ${tenantId}::uuid
          AND je.status = 'POSTED'
      ),
      account_activity AS (
        SELECT
          ga.id,
          ga.account_number,
          ga.name,
          ga.account_type::text AS account_type,
          ga.normal_balance::text AS normal_balance,
          COALESCE(SUM(CASE
            WHEN ${startSql} IS NOT NULL AND pl.entry_date < ${startSql}
              THEN pl.debit_amount - pl.credit_amount
            ELSE 0
          END), 0)::float8 AS opening_balance,
          COALESCE(SUM(CASE
            WHEN (${startSql} IS NULL OR pl.entry_date >= ${startSql})
              AND (${endSql} IS NULL OR pl.entry_date <= ${endSql})
              THEN pl.debit_amount
            ELSE 0
          END), 0)::float8 AS total_debits,
          COALESCE(SUM(CASE
            WHEN (${startSql} IS NULL OR pl.entry_date >= ${startSql})
              AND (${endSql} IS NULL OR pl.entry_date <= ${endSql})
              THEN pl.credit_amount
            ELSE 0
          END), 0)::float8 AS total_credits
        FROM gl_accounts ga
        LEFT JOIN posted_lines pl ON pl.gl_account_id = ga.id
        WHERE ga.tenant_id = ${tenantId}::uuid
          AND ga.is_active = true
          ${accountTypeFilter}
        GROUP BY ga.id, ga.account_number, ga.name, ga.account_type, ga.normal_balance
      ),
      enriched AS (
        SELECT
          *,
          (total_debits - total_credits) AS net_balance,
          (opening_balance + total_debits - total_credits) AS closing_balance
        FROM account_activity
        ${filters.showZero ? Prisma.empty : Prisma.sql`WHERE total_debits <> 0 OR total_credits <> 0 OR opening_balance <> 0`}
      )
    `;

    const detailRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        account_number: string;
        name: string;
        account_type: string;
        normal_balance: 'DEBIT' | 'CREDIT';
        opening_balance: number;
        total_debits: number;
        total_credits: number;
        net_balance: number;
        closing_balance: number;
      }>
    >(Prisma.sql`
      ${cte}
      SELECT * FROM enriched
      ${detailWhere}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await this.prisma.$queryRaw<[{ cnt: bigint }]>(Prisma.sql`
      ${cte}
      SELECT COUNT(*)::bigint AS cnt FROM enriched ${detailWhere}
    `);

    // Summary across the *entire* filtered result set, not just this page.
    const summaryRows = await this.prisma.$queryRaw<
      [
        {
          accounts_shown: bigint;
          total_debits: number;
          total_credits: number;
          sum_debit_balance: number;
          sum_credit_balance: number;
        },
      ]
    >(Prisma.sql`
      ${cte}
      SELECT
        COUNT(*)::bigint AS accounts_shown,
        COALESCE(SUM(total_debits), 0)::float8 AS total_debits,
        COALESCE(SUM(total_credits), 0)::float8 AS total_credits,
        COALESCE(SUM(GREATEST(closing_balance, 0)), 0)::float8 AS sum_debit_balance,
        COALESCE(SUM(GREATEST(-closing_balance, 0)), 0)::float8 AS sum_credit_balance
      FROM enriched
      ${detailWhere}
    `);

    const rows: TrialBalanceRow[] = detailRows.map((r) => ({
      id: r.id,
      accountNumber: r.account_number,
      name: r.name,
      accountType: r.account_type,
      normalBalance: r.normal_balance,
      openingBalance: Number(r.opening_balance ?? 0),
      totalDebits: Number(r.total_debits ?? 0),
      totalCredits: Number(r.total_credits ?? 0),
      netBalance: Number(r.net_balance ?? 0),
      closingBalance: Number(r.closing_balance ?? 0),
      debitBalance: Number(r.closing_balance ?? 0) > 0 ? Number(r.closing_balance) : 0,
      creditBalance: Number(r.closing_balance ?? 0) < 0 ? -Number(r.closing_balance) : 0,
    }));

    const summary = summaryRows[0];
    const sumDebit = Number(summary?.sum_debit_balance ?? 0);
    const sumCredit = Number(summary?.sum_credit_balance ?? 0);
    const netDiff = sumDebit - sumCredit;

    return {
      rows,
      total: Number(countRows[0]?.cnt ?? 0),
      summary: {
        accountsShown: Number(summary?.accounts_shown ?? 0),
        totalDebits: Number(summary?.total_debits ?? 0),
        totalCredits: Number(summary?.total_credits ?? 0),
        sumDebitBalance: sumDebit,
        sumCreditBalance: sumCredit,
        netDifference: netDiff,
        isBalanced: Math.abs(netDiff) < 0.01,
      },
    };
  }

  async getAccountLedger(
    tenantId: string,
    accountId: string,
    filters: AccountLedgerFilters,
  ): Promise<{
    account: { id: string; accountNumber: string; name: string; normalBalance: string; accountType: string };
    rows: Array<{
      id: string;
      lineId: string;
      entryDate: string;
      entryNumber: string;
      description: string | null;
      status: string;
      referenceType: string | null;
      debitAmount: number;
      creditAmount: number;
      runningBalance: number;
    }>;
    total: number;
    openingBalance: number;
  }> {
    const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);

    const accountRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        account_number: string;
        name: string;
        normal_balance: string;
        account_type: string;
      }>
    >(Prisma.sql`
      SELECT id, account_number, name, normal_balance::text AS normal_balance, account_type::text AS account_type
      FROM gl_accounts
      WHERE id = ${accountId}::uuid AND tenant_id = ${tenantId}::uuid
    `);
    if (!accountRows.length) {
      return {
        account: { id: accountId, accountNumber: '', name: '', normalBalance: '', accountType: '' },
        rows: [],
        total: 0,
        openingBalance: 0,
      };
    }
    const acct = accountRows[0];

    const startSql = filters.startDate ? Prisma.sql`${filters.startDate}::date` : Prisma.sql`NULL::date`;
    const endSql = filters.endDate ? Prisma.sql`${filters.endDate}::date` : Prisma.sql`NULL::date`;

    const openingRows = await this.prisma.$queryRaw<[{ opening: number }]>(Prisma.sql`
      SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0)::float8 AS opening
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.tenant_id = ${tenantId}::uuid
        AND je.status = 'POSTED'
        AND jl.gl_account_id = ${accountId}::uuid
        AND ${startSql} IS NOT NULL
        AND je.entry_date < ${startSql}
    `);
    const opening = Number(openingRows[0]?.opening ?? 0);

    const detailFilterConds = buildPharmaFilterSql(parsePharmaFilters(filters.filters), ACCOUNT_LEDGER_COLUMNS);
    const detailWhere = detailFilterConds.length
      ? Prisma.sql`AND ${Prisma.join(detailFilterConds, ' AND ')}`
      : Prisma.empty;
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy,
      filters.sortDir,
      ACCOUNT_LEDGER_COLUMNS,
      Prisma.sql`entry_date ASC, entry_number ASC`,
    );

    const baseCte = Prisma.sql`
      WITH lines AS (
        SELECT
          je.id AS entry_id,
          jl.id AS line_id,
          je.entry_date,
          je.entry_number,
          je.description,
          je.status::text AS status,
          je.reference_type,
          COALESCE(jl.debit_amount, 0)::float8 AS debit_amount,
          COALESCE(jl.credit_amount, 0)::float8 AS credit_amount
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.tenant_id = ${tenantId}::uuid
          AND je.status = 'POSTED'
          AND jl.gl_account_id = ${accountId}::uuid
          AND (${startSql} IS NULL OR je.entry_date >= ${startSql})
          AND (${endSql} IS NULL OR je.entry_date <= ${endSql})
      ),
      with_running AS (
        SELECT
          *,
          (${opening} + SUM(debit_amount - credit_amount)
            OVER (ORDER BY entry_date, entry_number ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::float8 AS running_balance
        FROM lines
      )
    `;

    const rows = await this.prisma.$queryRaw<
      Array<{
        entry_id: string;
        line_id: string;
        entry_date: Date;
        entry_number: string;
        description: string | null;
        status: string;
        reference_type: string | null;
        debit_amount: number;
        credit_amount: number;
        running_balance: number;
      }>
    >(Prisma.sql`
      ${baseCte}
      SELECT * FROM with_running
      WHERE 1=1 ${detailWhere}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await this.prisma.$queryRaw<[{ cnt: bigint }]>(Prisma.sql`
      ${baseCte}
      SELECT COUNT(*)::bigint AS cnt FROM with_running WHERE 1=1 ${detailWhere}
    `);

    return {
      account: {
        id: acct.id,
        accountNumber: acct.account_number,
        name: acct.name,
        normalBalance: acct.normal_balance,
        accountType: acct.account_type,
      },
      openingBalance: opening,
      rows: rows.map((r) => ({
        id: r.entry_id,
        lineId: r.line_id,
        entryDate: r.entry_date.toISOString(),
        entryNumber: r.entry_number,
        description: r.description,
        status: r.status,
        referenceType: r.reference_type,
        debitAmount: Number(r.debit_amount),
        creditAmount: Number(r.credit_amount),
        runningBalance: Number(r.running_balance),
      })),
      total: Number(countRows[0]?.cnt ?? 0),
    };
  }
}
