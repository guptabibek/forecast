/**
 * Thin HTTP client that talks directly to the NestJS API from inside E2E tests.
 * Useful for seeding/cleaning data or asserting backend state without going through the UI.
 *
 * Usage:
 *   import { ApiClient } from './helpers/api-client.js';
 *   const api = new ApiClient();
 *   await api.login();
 *   const plans = await api.get('/plans');
 */
import type { APIRequestContext } from '@playwright/test';
import { request } from '@playwright/test';

const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

export class ApiClient {
  private context!: APIRequestContext;
  private token = '';

  /** Prepend /api/v1 to each path so callers can pass short paths like /plans */
  private v(path: string) {
    return `/api/v1${path.startsWith('/') ? path : '/' + path}`;
  }

  async init() {
    this.context = await request.newContext({ baseURL: API_BASE });
  }

  async login(email = ADMIN_EMAIL, password = ADMIN_PASSWORD, tenantSlug = 'demo') {
    if (!this.context) await this.init();
    const res = await this.context.post(this.v('/auth/login'), { data: { email, password, tenantSlug } });
    const body = await res.json();
    this.token = body?.access_token ?? body?.accessToken ?? '';
    return body;
  }

  private authHeaders() {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async get(path: string) {
    const res = await this.context.get(this.v(path), { headers: this.authHeaders() });
    return res.json();
  }

  async post(path: string, data: unknown) {
    const res = await this.context.post(this.v(path), {
      data,
      headers: this.authHeaders(),
    });
    return { status: res.status(), body: await res.json().catch(() => null) };
  }

  async put(path: string, data: unknown) {
    const res = await this.context.put(this.v(path), {
      data,
      headers: this.authHeaders(),
    });
    return { status: res.status(), body: await res.json().catch(() => null) };
  }

  async delete(path: string) {
    const res = await this.context.delete(this.v(path), { headers: this.authHeaders() });
    return res.status();
  }

  async dispose() {
    await this.context?.dispose();
  }
}
