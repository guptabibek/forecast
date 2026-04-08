import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

describe('PrismaService tenant scoping middleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scopes findUnique to tenant context', async () => {
    let middleware: ((params: any, next: (params: any) => Promise<any>) => Promise<any>) | undefined;

    jest.spyOn(PrismaClient.prototype as any, '$use').mockImplementation(function (fn: any) {
      middleware = fn;
      return this;
    });

    const service = new PrismaService({ get: jest.fn(() => 'tenant-1') } as any);
    expect(service).toBeDefined();
    expect(middleware).toBeDefined();

    const next = jest.fn(async (params: any) => params);
    const result = await middleware!(
      {
        model: 'User',
        action: 'findUnique',
        args: { where: { id: 'user-1' } },
      },
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(result.action).toBe('findFirst');
    expect(result.args.where).toEqual({ id: 'user-1', tenantId: 'tenant-1' });
  });

  it('injects tenantId into createMany rows', async () => {
    let middleware: ((params: any, next: (params: any) => Promise<any>) => Promise<any>) | undefined;

    jest.spyOn(PrismaClient.prototype as any, '$use').mockImplementation(function (fn: any) {
      middleware = fn;
      return this;
    });

    new PrismaService({ get: jest.fn(() => 'tenant-1') } as any);

    const next = jest.fn(async (params: any) => params);
    const result = await middleware!(
      {
        model: 'User',
        action: 'createMany',
        args: {
          data: [
            { email: 'user1@example.com' },
            { email: 'user2@example.com' },
          ],
        },
      },
      next,
    );

    expect(result.args.data).toEqual([
      { email: 'user1@example.com', tenantId: 'tenant-1' },
      { email: 'user2@example.com', tenantId: 'tenant-1' },
    ]);
  });

  it('does not alter non-tenant models', async () => {
    let middleware: ((params: any, next: (params: any) => Promise<any>) => Promise<any>) | undefined;

    jest.spyOn(PrismaClient.prototype as any, '$use').mockImplementation(function (fn: any) {
      middleware = fn;
      return this;
    });

    new PrismaService({ get: jest.fn(() => 'tenant-1') } as any);

    const params = {
      model: 'Tenant',
      action: 'findUnique',
      args: { where: { id: 'tenant-1' } },
    };

    const next = jest.fn(async (input: any) => input);
    const result = await middleware!(params, next);

    expect(result).toEqual(params);
  });

  it('leaves args unchanged when tenant context is missing', async () => {
    let middleware: ((params: any, next: (params: any) => Promise<any>) => Promise<any>) | undefined;

    jest.spyOn(PrismaClient.prototype as any, '$use').mockImplementation(function (fn: any) {
      middleware = fn;
      return this;
    });

    new PrismaService({ get: jest.fn(() => undefined) } as any);

    const params = {
      model: 'User',
      action: 'findMany',
      args: { where: { status: 'ACTIVE' } },
    };

    const next = jest.fn(async (input: any) => input);
    const result = await middleware!(params, next);

    expect(result).toEqual(params);
  });
});
