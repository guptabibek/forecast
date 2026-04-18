import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

/**
 * The super-admin's synthetic tenant ID has no DB row.
 * Skip automatic tenant-scoping when this is the active CLS tenant so that
 * platform-level (cross-tenant) queries are not incorrectly filtered.
 */
const SA_SYNTHETIC_TENANT_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly tenantScopedModels = new Set(
    Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
      .map((model) => model.name),
  );

  constructor(private readonly cls: ClsService) {
    super({
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'info', 'warn', 'error'] 
        : ['error'],
    });

    // Middleware: Set RLS session variable for every model query.
    // IMPORTANT: Skip raw queries (`!params.model`) — `$queryRawUnsafe` called
    // from within this middleware would re-trigger `$use`, creating infinite
    // async recursion and eventual OOM.
    this.$use(async (params, next) => {
      if (!params.model) {
        return next(params);
      }
      const tenantId = this.getTenantId();
      if (tenantId && tenantId !== SA_SYNTHETIC_TENANT_ID) {
        try {
          // Use parameterized set_config() instead of string interpolation to prevent SQL injection
          await this.$queryRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantId);
        } catch {
          // SET LOCAL only works inside a transaction; ignore for non-transactional queries
          // RLS will fall back to permissive (current_tenant_id() returns NULL)
        }
      }
      return next(params);
    });

    // Middleware: Auto-inject tenantId into all tenant-scoped queries
    this.$use(async (params, next) => {
      const modelName = params.model;
      if (!modelName || !this.tenantScopedModels.has(modelName)) {
        return next(params);
      }

      const tenantId = this.getTenantId();
      if (!tenantId || tenantId === SA_SYNTHETIC_TENANT_ID) {
        // Strict mode: warn when tenant-scoped model is accessed without tenant context
        // This catches accidental bypasses in background jobs or misconfigured routes
        if (process.env.NODE_ENV !== 'test') {
          this.logger.warn(
            `Tenant-scoped model "${modelName}" accessed without tenant context (action: ${params.action}). ` +
            `This query will run WITHOUT tenant filtering. Ensure CLS is initialized for background jobs.`,
          );
        }
        return next(params);
      }

      const args = params.args || {};

      switch (params.action) {
        case 'findUnique': {
          params.action = 'findFirst';
          args.where = this.mergeWhereWithTenant(args.where, tenantId);
          break;
        }
        case 'findUniqueOrThrow': {
          params.action = 'findFirstOrThrow';
          args.where = this.mergeWhereWithTenant(args.where, tenantId);
          break;
        }
        case 'findFirst':
        case 'findFirstOrThrow':
        case 'findMany':
        case 'count':
        case 'aggregate':
        case 'groupBy':
        case 'update':
        case 'updateMany':
        case 'delete':
        case 'deleteMany': {
          args.where = this.mergeWhereWithTenant(args.where, tenantId);
          break;
        }
        case 'create': {
          args.data = this.mergeDataWithTenant(args.data, tenantId);
          break;
        }
        case 'createMany': {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((item: Record<string, unknown>) => this.mergeDataWithTenant(item, tenantId));
          } else {
            args.data = this.mergeDataWithTenant(args.data, tenantId);
          }
          break;
        }
        case 'upsert': {
          args.where = this.mergeWhereWithTenant(args.where, tenantId);
          args.create = this.mergeDataWithTenant(args.create, tenantId);
          args.update = this.mergeDataWithTenant(args.update, tenantId);
          break;
        }
        default:
          break;
      }

      params.args = args;
      return next(params);
    });
  }

  private mergeWhereWithTenant(where: Record<string, unknown> | undefined, tenantId: string) {
    return {
      ...(where || {}),
      tenantId,
    };
  }

  private mergeDataWithTenant(data: Record<string, unknown> | undefined, tenantId: string) {
    // Skip if tenant info is already provided (relation-style `tenant` or scalar `tenantId`)
    // to avoid mixing checked/unchecked Prisma create inputs.
    if (data && (data.tenantId || data.tenant)) {
      return data;
    }
    return {
      ...(data || {}),
      tenantId,
    };
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * Get current tenant ID from context
   */
  getTenantId(): string | undefined {
    try {
      return this.cls.isActive() ? this.cls.get('tenantId') : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Set tenant context in CLS for background job processing.
   * Call this at the start of queue processor handlers to enable
   * automatic tenant scoping via Prisma middleware.
   */
  setTenantContext(tenantId: string): void {
    if (this.cls.isActive()) {
      this.cls.set('tenantId', tenantId);
    }
  }

  /**
   * Get a tenant-scoped Prisma client that automatically filters by tenant_id
   */
  forTenant() {
    const tenantId = this.getTenantId();

    if (!tenantId) {
      throw new Error('Tenant context not available');
    }

    return this.$extends({
      query: {
        $allModels: {
          async findMany({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
          async findFirst({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
          async findUnique({ args, query }: { args: any; query: any }) {
            const result = await query(args);
            if (result && (result as any).tenantId !== tenantId) {
              return null;
            }
            return result;
          },
          async create({ args, query }: { args: any; query: any }) {
            args.data = { ...args.data, tenantId };
            return query(args);
          },
          async createMany({ args, query }: { args: any; query: any }) {
            if (Array.isArray(args.data)) {
              args.data = args.data.map((d: any) => ({ ...d, tenantId }));
            } else {
              args.data = { ...args.data, tenantId };
            }
            return query(args);
          },
          async update({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
          async updateMany({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
          async delete({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
          async deleteMany({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
          async count({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
          async aggregate({ args, query }: { args: any; query: any }) {
            args.where = { ...args.where, tenantId };
            return query(args);
          },
        },
      },
    });
  }

  /**
   * Execute a callback within a database transaction
   */
  async executeInTransaction<T>(
    callback: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.$transaction(callback, {
      maxWait: options?.maxWait ?? 10000,
      timeout: options?.timeout ?? 120000,
    });
  }

  /**
   * Execute a callback within a CLS context scoped to a specific tenant.
   * Use this in background job processors to enable automatic tenant filtering.
   */
  async executeInTenantContext<T>(tenantId: string, callback: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set('tenantId', tenantId);
      return callback();
    });
  }
}
