import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

const authService = {
  register: jest.fn(async () => ({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 900,
    tokenType: 'Bearer',
    user: { id: 'user-1', email: 'user@example.com', firstName: 'John', lastName: 'Doe', role: 'ADMIN' },
    tenant: { id: 'tenant-1', name: 'Tenant', slug: 'acme' },
  })),
  login: jest.fn(async (dto: any) => ({
    accessToken: 'access-token',
    refreshToken: dto?.email ? 'refresh-token-login' : 'refresh-token',
    expiresIn: 900,
    tokenType: 'Bearer',
    user: { id: 'user-1', email: dto.email, firstName: 'John', lastName: 'Doe', role: 'ADMIN' },
    tenant: { id: 'tenant-1', name: 'Tenant', slug: dto.tenantSlug ?? 'acme' },
  })),
  refreshToken: jest.fn(async () => ({
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
    expiresIn: 900,
    tokenType: 'Bearer',
    user: { id: 'user-1', email: 'user@example.com', firstName: 'John', lastName: 'Doe', role: 'ADMIN' },
    tenant: { id: 'tenant-1', name: 'Tenant', slug: 'acme' },
  })),
  logout: jest.fn(async () => undefined),
  getCurrentUser: jest.fn(async () => ({ id: 'user-1', email: 'user@example.com' })),
  getUserSessions: jest.fn(async () => [{ id: 'sess-1' }]),
  revokeSessionById: jest.fn(async () => undefined),
  revokeAllOtherSessions: jest.fn(async () => undefined),
  changePassword: jest.fn(async () => undefined),
  requestPasswordReset: jest.fn(async () => undefined),
  resetPassword: jest.fn(async () => undefined),
};

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  const originalAllowDemo = process.env.ALLOW_DEMO_TENANT_FALLBACK;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.ALLOW_DEMO_TENANT_FALLBACK = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request & { user?: any }, _res: Response, next: NextFunction) => {
      req.user = { sub: 'user-1' };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    process.env.ALLOW_DEMO_TENANT_FALLBACK = originalAllowDemo;
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const cookieHeader = (value: string | string[] | undefined): string => {
    if (!value) return '';
    return Array.isArray(value) ? value.join(';') : value;
  };

  it('logs in, resolves tenant from header, and does not expose refreshToken in body', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'ACME')
      .send({ email: 'user@example.com', password: 'SecurePass123!' })
      .expect(200);

    expect(response.body.refreshToken).toBeUndefined();
    expect(cookieHeader(response.headers['set-cookie'] as string | string[] | undefined)).toContain('fh_rt=refresh-token-login');
    expect(authService.login).toHaveBeenCalledTimes(1);
    expect(authService.login.mock.calls[0][0].tenantSlug).toBe('acme');
  });

  it('rejects refresh when token is missing from body and cookie', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({})
      .expect(400);
  });

  it('refreshes token using cookie token and rotates cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', ['fh_rt=refresh-cookie-token'])
      .send({})
      .expect(200);

    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect((authService.refreshToken as any).mock.calls[0][0].refreshToken).toBe('refresh-cookie-token');
    expect(response.body.refreshToken).toBeUndefined();
    expect(cookieHeader(response.headers['set-cookie'] as string | string[] | undefined)).toContain('fh_rt=new-refresh-token');
  });

  it('rejects forgot-password when tenant cannot be resolved', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Host', 'localhost:3000')
      .send({ email: 'user@example.com' })
      .expect(400);
  });

  it('returns sessions using current user and cookie refresh token', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set('Cookie', ['fh_rt=refresh-session-token'])
      .expect(200);

    expect(response.body).toEqual([{ id: 'sess-1' }]);
    expect(authService.getUserSessions).toHaveBeenCalledWith('user-1', 'refresh-session-token');
  });
});
