import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

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

    this.$use(async (params, next) => {
      const modelName = params.model;
      if (!modelName || !this.tenantScopedModels.has(modelName)) {
        return next(params);
      }

      const tenantId = this.getTenantId();
      if (!tenantId) {
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
    return this.cls.get('tenantId');
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
  ): Promise<T> {
    return this.$transaction(callback);
  }
}
