import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GLAccountType, JournalEntryStatus, NormalBalance, PostingTransactionType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../core/database/prisma.service';
import { SequenceService } from './sequence.service';

/**
 * AccountingService — Double-entry General Ledger engine.
 *
 * Enforces fundamental accounting invariants:
 * 1. Every journal entry must balance (total debits = total credits)
 * 2. No posting to locked fiscal periods
 * 3. Idempotency keys prevent duplicate postings
 * 4. Reversals create mirror entries, never mutate originals
 * 5. Posting profiles map transaction types → GL accounts automatically
 */
@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // GL Account Management
  // ────────────────────────────────────────────────────────────────────────

  async createGLAccount(
    tenantId: string,
    data: {
      accountNumber: string;
      name: string;
      accountType: GLAccountType;
      parentId?: string;
      normalBalance?: NormalBalance;
      description?: string;
      isSystem?: boolean;
    },
  ) {
    return this.prisma.gLAccount.create({
      data: {
        tenantId,
        accountNumber: data.accountNumber,
        name: data.name,
        accountType: data.accountType,
        parentId: data.parentId,
        normalBalance: data.normalBalance ?? NormalBalance.DEBIT,
        description: data.description,
        isSystem: data.isSystem ?? false,
      },
    });
  }

  async getGLAccounts(tenantId: string, filters?: { accountType?: GLAccountType; isActive?: boolean }) {
    return this.prisma.gLAccount.findMany({
      where: {
        tenantId,
        ...(filters?.accountType && { accountType: filters.accountType }),
        ...(filters?.isActive !== undefined && { isActive: filters.isActive }),
      },
      include: { children: true },
      orderBy: { accountNumber: 'asc' },
    });
  }

  async getGLAccount(tenantId: string, id: string) {
    return this.prisma.gLAccount.findFirstOrThrow({
      where: { id, tenantId },
      include: { children: true, parent: true },
    });
  }

  async updateGLAccount(
    tenantId: string,
    id: string,
    data: { name?: string; description?: string; isActive?: boolean; parentId?: string },
  ) {
    // Verify the GL account belongs to this tenant
    await this.prisma.gLAccount.findFirstOrThrow({
      where: { id, tenantId },
    });
    return this.prisma.gLAccount.update({
      where: { id },
      data,
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Posting Profiles
  // ────────────────────────────────────────────────────────────────────────

  async createPostingProfile(
    tenantId: string,
    data: {
      profileName: string;
      transactionType: PostingTransactionType;
      debitAccountId: string;
      creditAccountId: string;
      productCategory?: string;
      locationId?: string;
      priority?: number;
      description?: string;
    },
  ) {
    // Validate that debit and credit accounts exist and belong to tenant
    const [debitAcct, creditAcct] = await Promise.all([
      this.prisma.gLAccount.findFirst({ where: { id: data.debitAccountId, tenantId } }),
      this.prisma.gLAccount.findFirst({ where: { id: data.creditAccountId, tenantId } }),
    ]);

    if (!debitAcct) throw new BadRequestException('Debit GL account not found');
    if (!creditAcct) throw new BadRequestException('Credit GL account not found');

    return this.prisma.postingProfile.create({
      data: {
        tenantId,
        profileName: data.profileName,
        transactionType: data.transactionType,
        debitAccountId: data.debitAccountId,
        creditAccountId: data.creditAccountId,
        productCategory: data.productCategory,
        locationId: data.locationId,
        priority: data.priority ?? 0,
        description: data.description,
      },
    });
  }

  async getPostingProfiles(tenantId: string, transactionType?: PostingTransactionType) {
    return this.prisma.postingProfile.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(transactionType && { transactionType }),
      },
      include: { debitAccount: true, creditAccount: true },
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * Resolve the correct posting profile for a transaction.
   * Matches by transaction type, then narrows by product category and location.
   * Higher priority profiles take precedence.
   */
  async resolvePostingProfile(
    tenantId: string,
    transactionType: PostingTransactionType,
    productCategory?: string,
    locationId?: string,
  ) {
    const profiles = await this.prisma.postingProfile.findMany({
      where: {
        tenantId,
        transactionType,
        isActive: true,
      },
      orderBy: { priority: 'desc' },
    });

    // Find best match: most specific first
    const match = profiles.find((p) => {
      const categoryMatch = !p.productCategory || p.productCategory === productCategory;
      const locationMatch = !p.locationId || p.locationId === locationId;
      return categoryMatch && locationMatch;
    });

    if (!match) {
      // Fall back to any profile for this transaction type
      return profiles[0] ?? null;
    }

    return match;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Journal Entries — Double-Entry Posting
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Create a balanced journal entry with lines.
   * Enforces: total debits = total credits.
   * Enforces: fiscal period not locked.
   * Supports idempotency keys for exactly-once posting.
   */
  async createJournalEntry(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      entryDate: Date;
      referenceType: string;
      referenceId?: string;
      description?: string;
      postedById: string;
      idempotencyKey?: string;
      fiscalPeriodId?: string | null;
      currency?: string;
      lines: Array<{
        glAccountId: string;
        debitAmount?: Decimal | number;
        creditAmount?: Decimal | number;
        productId?: string;
        locationId?: string;
        costCenterId?: string;
        description?: string;
      }>;
    },
  ) {
    // Idempotency check
    if (params.idempotencyKey) {
      const existing = await tx.journalEntry.findFirst({
        where: {
          tenantId: params.tenantId,
          idempotencyKey: params.idempotencyKey,
        },
      });
      if (existing) return existing;
    }

    // Validate fiscal period not locked
    await this.validatePeriodOpen(tx, params.tenantId, params.entryDate);

    // Validate balance
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);

    for (const line of params.lines) {
      totalDebit = totalDebit.add(new Decimal((line.debitAmount ?? 0).toString()));
      totalCredit = totalCredit.add(new Decimal((line.creditAmount ?? 0).toString()));
    }

    if (!totalDebit.eq(totalCredit)) {
      throw new BadRequestException(
        `Journal entry must balance. Debits: ${totalDebit}, Credits: ${totalCredit}`,
      );
    }

    if (totalDebit.isZero()) {
      throw new BadRequestException('Journal entry must have non-zero amounts');
    }

    // Use explicit fiscalPeriodId if provided, otherwise resolve from date
    const fiscalPeriod = params.fiscalPeriodId
      ? await tx.fiscalPeriod.findUnique({ where: { id: params.fiscalPeriodId } })
      : await this.findFiscalPeriod(tx, params.tenantId, params.entryDate);

    // Generate entry number via DB sequence (concurrency-safe)
    const entryNumber = await this.sequence.nextNumber(tx, 'JE');

    // Resolve currency: explicit param → tenant default → fail
    let resolvedCurrency = params.currency;
    if (!resolvedCurrency) {
      const tenant = await tx.tenant.findUnique({ where: { id: params.tenantId }, select: { defaultCurrency: true } });
      resolvedCurrency = tenant?.defaultCurrency;
      if (!resolvedCurrency) {
        throw new BadRequestException(
          `Tenant ${params.tenantId} has no default currency configured. Set tenant.defaultCurrency before posting journal entries.`,
        );
      }
    }

    // Create journal entry with lines
    const entry = await tx.journalEntry.create({
      data: {
        tenantId: params.tenantId,
        entryNumber,
        entryDate: params.entryDate,
        fiscalPeriodId: fiscalPeriod?.id,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        description: params.description,
        postedById: params.postedById,
        idempotencyKey: params.idempotencyKey,
        currency: resolvedCurrency,
        totalDebit,
        totalCredit,
        status: JournalEntryStatus.POSTED,
        lines: {
          create: params.lines.map((line, idx) => ({
            lineNumber: idx + 1,
            glAccountId: line.glAccountId,
            debitAmount: new Decimal((line.debitAmount ?? 0).toString()),
            creditAmount: new Decimal((line.creditAmount ?? 0).toString()),
            productId: line.productId,
            locationId: line.locationId,
            costCenterId: line.costCenterId,
            description: line.description,
          })),
        },
      },
      include: { lines: true },
    });

    return entry;
  }

  /**
   * Auto-post a transaction using posting profiles.
   * Looks up the appropriate GL accounts from posting profiles,
   * then creates a balanced journal entry.
   */
  async autoPost(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      transactionType: PostingTransactionType;
      amount: Decimal | number;
      entryDate: Date;
      referenceType: string;
      referenceId?: string;
      productId?: string;
      productCategory?: string;
      locationId?: string;
      costCenterId?: string;
      postedById: string;
      idempotencyKey?: string;
      fiscalPeriodId?: string | null;
      description?: string;
    },
  ) {
    const profile = await this.resolvePostingProfile(
      params.tenantId,
      params.transactionType,
      params.productCategory,
      params.locationId,
    );

    if (!profile) {
      // No posting profile configured — log warning and throw.
      // Silent null return is dangerous: caller assumes posting succeeded.
      this.logger.warn(
        `No posting profile found for ${params.transactionType} in tenant ${params.tenantId}. ` +
        `Configure a PostingProfile to enable auto-posting.`,
      );
      throw new BadRequestException(
        `No posting profile configured for transaction type ${params.transactionType}. ` +
        `Create a PostingProfile before performing this operation.`,
      );
    }

    const amount = new Decimal(params.amount.toString());

    return this.createJournalEntry(tx, {
      tenantId: params.tenantId,
      entryDate: params.entryDate,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      description: params.description ?? `Auto-post: ${params.transactionType}`,
      postedById: params.postedById,
      idempotencyKey: params.idempotencyKey,
      fiscalPeriodId: params.fiscalPeriodId,
      lines: [
        {
          glAccountId: profile.debitAccountId,
          debitAmount: amount,
          creditAmount: 0,
          productId: params.productId,
          locationId: params.locationId,
          costCenterId: params.costCenterId,
          description: `${params.transactionType} - Debit`,
        },
        {
          glAccountId: profile.creditAccountId,
          debitAmount: 0,
          creditAmount: amount,
          productId: params.productId,
          locationId: params.locationId,
          costCenterId: params.costCenterId,
          description: `${params.transactionType} - Credit`,
        },
      ],
    });
  }

  /**
   * High-level transactional journal posting — called by CostingEngineService.
   * Wraps autoPost with a simpler parameter set. Runs inside an existing transaction.
   */
  async postTransactionalJournal(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      transactionType: PostingTransactionType;
      referenceType: string;
      referenceId: string;
      entryDate: Date;
      fiscalPeriodId?: string | null;
      amount: Decimal | number;
      productId?: string;
      locationId?: string;
      description?: string;
      userId: string;
    },
  ) {
    return this.autoPost(tx, {
      tenantId: params.tenantId,
      transactionType: params.transactionType,
      amount: params.amount,
      entryDate: params.entryDate,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      productId: params.productId,
      locationId: params.locationId,
      postedById: params.userId,
      fiscalPeriodId: params.fiscalPeriodId,
      idempotencyKey: `${params.transactionType}:${params.referenceId}`,
      description: params.description,
    });
  }

  /**
   * Reverse a journal entry. Creates a mirror entry with opposite debits/credits.
   * Original entry is marked as reversed; reversal references the original.
   */
  async reverseJournalEntry(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      journalEntryId: string;
      postedById: string;
      reason?: string;
    },
  ) {
    const original = await tx.journalEntry.findUniqueOrThrow({
      where: { id: params.journalEntryId },
      include: { lines: true },
    });

    // Tenant isolation: verify JE belongs to caller's tenant
    if (original.tenantId !== params.tenantId) {
      throw new BadRequestException('Journal entry not found');
    }

    if (original.isReversed) {
      throw new BadRequestException('Journal entry has already been reversed');
    }

    if (original.status === JournalEntryStatus.REVERSED) {
      throw new BadRequestException('Cannot reverse a reversal entry');
    }

    // Validate the REVERSAL entry's fiscal period is open
    await this.validatePeriodOpen(tx, original.tenantId, new Date());

    // Generate reversal entry number via DB sequence
    const entryNumber = await this.sequence.nextNumber(tx, 'JE');

    const reversal = await tx.journalEntry.create({
      data: {
        tenantId: original.tenantId,
        entryNumber,
        entryDate: new Date(),
        // Use current date's fiscal period, not the original's
        fiscalPeriodId: (await this.findFiscalPeriod(tx, original.tenantId, new Date()))?.id,
        referenceType: 'REVERSAL',
        referenceId: original.id,
        reversalOfId: original.id,
        description: params.reason ?? `Reversal of ${original.entryNumber}`,
        postedById: params.postedById,
        currency: original.currency,
        totalDebit: original.totalCredit, // Swap
        totalCredit: original.totalDebit, // Swap
        status: JournalEntryStatus.POSTED,
        lines: {
          create: original.lines.map((line, idx) => ({
            lineNumber: idx + 1,
            glAccountId: line.glAccountId,
            debitAmount: line.creditAmount, // Swap
            creditAmount: line.debitAmount, // Swap
            productId: line.productId,
            locationId: line.locationId,
            costCenterId: line.costCenterId,
            description: `Reversal: ${line.description ?? ''}`,
          })),
        },
      },
      include: { lines: true },
    });

    // Mark original as reversed
    await tx.journalEntry.update({
      where: { id: original.id },
      data: { isReversed: true },
    });

    return reversal;
  }

  /**
   * Get journal entries with filtering and pagination.
   */

  /**
   * Convenience wrapper for reverseJournalEntry that manages its own transaction.
   */
  async reverseJournalEntryById(tenantId: string, journalEntryId: string, postedById: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      return this.reverseJournalEntry(tx, { tenantId, journalEntryId, postedById, reason });
    });
  }

  async getJournalEntries(
    tenantId: string,
    filters?: {
      fromDate?: Date;
      toDate?: Date;
      referenceType?: string;
      referenceId?: string;
      fiscalPeriodId?: string;
      status?: JournalEntryStatus;
    },
    pagination?: { skip?: number; take?: number },
  ) {
    const where: Prisma.JournalEntryWhereInput = {
      tenantId,
      ...(filters?.fromDate && { entryDate: { gte: filters.fromDate } }),
      ...(filters?.toDate && { entryDate: { lte: filters.toDate } }),
      ...(filters?.referenceType && { referenceType: filters.referenceType }),
      ...(filters?.referenceId && { referenceId: filters.referenceId }),
      ...(filters?.fiscalPeriodId && { fiscalPeriodId: filters.fiscalPeriodId }),
      ...(filters?.status && { status: filters.status }),
    };

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: { lines: { include: { glAccount: true } } },
        orderBy: { createdAt: 'desc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 50,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { entries, total };
  }

  /**
   * Get GL account balances (trial balance).
   * Sums all journal entry lines per GL account.
   */
  async getTrialBalance(
    tenantId: string,
    filters?: { fromDate?: Date; toDate?: Date; fiscalPeriodId?: string },
  ) {
    let dateFilter: Prisma.Sql = Prisma.empty;
    let periodFilter: Prisma.Sql = Prisma.empty;
    if (filters?.fromDate && filters?.toDate) {
      dateFilter = Prisma.sql`AND je.entry_date BETWEEN ${filters.fromDate} AND ${filters.toDate}`;
    } else if (filters?.fromDate) {
      dateFilter = Prisma.sql`AND je.entry_date >= ${filters.fromDate}`;
    } else if (filters?.toDate) {
      dateFilter = Prisma.sql`AND je.entry_date <= ${filters.toDate}`;
    }

    if (filters?.fiscalPeriodId) {
      periodFilter = Prisma.sql`AND je.fiscal_period_id = ${filters.fiscalPeriodId}`;
    }

    return this.prisma.$queryRaw(Prisma.sql`
      SELECT
        ga.id,
        ga.account_number,
        ga.name,
        ga.account_type,
        ga.normal_balance,
        COALESCE(SUM(jl.debit_amount), 0) as total_debits,
        COALESCE(SUM(jl.credit_amount), 0) as total_credits,
        COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0) as net_balance
      FROM gl_accounts ga
      LEFT JOIN journal_entry_lines jl ON jl.gl_account_id = ga.id
      LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
        AND je.tenant_id = ${tenantId}
        AND je.status = 'POSTED'
        ${dateFilter}
        ${periodFilter}
      WHERE ga.tenant_id = ${tenantId} AND ga.is_active = true
      GROUP BY ga.id, ga.account_number, ga.name, ga.account_type, ga.normal_balance
      ORDER BY ga.account_number
    `);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Fiscal Period Locking
  // ────────────────────────────────────────────────────────────────────────

  async lockFiscalPeriod(tenantId: string, periodId: string, lockedById: string) {
    return this.prisma.$transaction(async (tx) => {
      // Pessimistic lock to prevent concurrent lock/unlock races
      const rows = await tx.$queryRaw<Array<{ id: string; calendar_id: string }>>(
        Prisma.sql`SELECT fp.id, fp.calendar_id FROM fiscal_periods fp
         JOIN fiscal_calendars fc ON fc.id = fp.calendar_id
         WHERE fp.id = ${periodId} AND fc.tenant_id = ${tenantId}
         FOR UPDATE`,
      );
      if (!rows.length) {
        throw new BadRequestException('Fiscal period not found');
      }

      const updated = await tx.fiscalPeriod.update({
        where: { id: periodId },
        data: {
          isLocked: true,
          lockedAt: new Date(),
          lockedById,
        },
      });

      // Audit trail for SOX compliance
      this.logger.log(
        `Fiscal period ${periodId} LOCKED by user ${lockedById} for tenant ${tenantId}`,
      );

      return updated;
    });
  }

  async unlockFiscalPeriod(tenantId: string, periodId: string, unlockedById?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Pessimistic lock to prevent concurrent lock/unlock races
      const rows = await tx.$queryRaw<Array<{ id: string; calendar_id: string }>>(
        Prisma.sql`SELECT fp.id, fp.calendar_id FROM fiscal_periods fp
         JOIN fiscal_calendars fc ON fc.id = fp.calendar_id
         WHERE fp.id = ${periodId} AND fc.tenant_id = ${tenantId}
         FOR UPDATE`,
      );
      if (!rows.length) {
        throw new BadRequestException('Fiscal period not found');
      }

      const updated = await tx.fiscalPeriod.update({
        where: { id: periodId },
        data: {
          isLocked: false,
          lockedAt: null,
          lockedById: null,
        },
      });

      // Audit trail for SOX compliance
      this.logger.log(
        `Fiscal period ${periodId} UNLOCKED by user ${unlockedById ?? 'system'} for tenant ${tenantId}`,
      );

      return updated;
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────

  private async validatePeriodOpen(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entryDate: Date,
  ) {
    // Find fiscal period containing this date
    const period = await this.findFiscalPeriod(tx, tenantId, entryDate);
    if (!period) {
      this.logger.warn(
        `No fiscal period found for date ${entryDate.toISOString()} in tenant ${tenantId}. ` +
        `Journal entry will be posted without a fiscal period. Configure a FiscalCalendar to enable period controls.`,
      );
      return;
    }
    if (period?.isLocked) {
      throw new BadRequestException(
        `Fiscal period ${period.periodName} is locked. Cannot post entries to a locked period.`,
      );
    }
    if (period?.isClosed) {
      throw new BadRequestException(
        `Fiscal period ${period.periodName} is closed.`,
      );
    }
  }

  private async findFiscalPeriod(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entryDate: Date,
  ) {
    const calendar = await tx.fiscalCalendar.findFirst({
      where: { tenantId, isDefault: true },
    });

    if (!calendar) return null;

    return tx.fiscalPeriod.findFirst({
      where: {
        calendarId: calendar.id,
        startDate: { lte: entryDate },
        endDate: { gte: entryDate },
      },
    });
  }
}
