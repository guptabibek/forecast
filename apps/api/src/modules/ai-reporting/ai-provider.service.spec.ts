import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service';
import { AiReportingUnavailable } from './ai-reporting.errors';
import { AiProviderService } from './ai-provider.service';

describe('AiProviderService', () => {
  const originalFetch = global.fetch;
  const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const JWT_SECRET_32 = 'a'.repeat(32);

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function service(config: Record<string, string | undefined>, row: Record<string, unknown>) {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    const prisma = {
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM ai_tenant_provider_configs')) {
          return [row];
        }
        return [];
      }),
      $executeRawUnsafe: jest.fn(async () => 1),
    } as unknown as PrismaService;
    const provider = new AiProviderService(configService, prisma);
    const apiKeyEncrypted = (provider as any).encryptSecret(row.api_key_plain ?? 'test-key') as string;
    (prisma as any).$queryRawUnsafe = jest.fn(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM ai_tenant_provider_configs')) {
        return [{ ...row, api_key_encrypted: apiKeyEncrypted }];
      }
      return [];
    });
    return provider;
  }

  function tenantRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'config-1',
      tenant_id: TEST_TENANT_ID,
      provider: 'openai',
      model: 'gpt-5.4-mini',
      summary_model: null,
      api_key_last4: 'key',
      api_key_fingerprint: 'fp',
      endpoint_url: null,
      organization_id: null,
      enabled: true,
      max_tokens: 1200,
      temperature: 0,
      monthly_token_limit: null,
      monthly_cost_limit_cents: null,
      input_token_cost_per_1m_cents: null,
      output_token_cost_per_1m_cents: null,
      last_tested_at: null,
      last_test_status: null,
      last_test_error: null,
      updated_at: null,
      api_key_plain: 'test-key',
      ...overrides,
    };
  }

  it('uses max_completion_tokens and omits temperature for reasoning-style models', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"status":"ok"}' } }],
      }),
    });
    global.fetch = fetchMock as any;

    const provider = service(
      { JWT_SECRET: JWT_SECRET_32, AI_TIMEOUT_MS: '30000' },
      tenantRow({ model: 'gpt-5.4-mini', max_tokens: 1200, temperature: 0 }),
    );

    await expect(
      provider.generateJson([{ role: 'user', content: 'Return JSON.' }], { tenantId: TEST_TENANT_ID }),
    ).resolves.toEqual({ status: 'ok' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(1200);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('returns a specific safe error when the provider rejects the configured model', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        error: {
          message: 'The model `gpt-unknown` does not exist or you do not have access to it.',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      })),
    }) as any;

    const provider = service(
      { JWT_SECRET: JWT_SECRET_32, AI_TIMEOUT_MS: '30000' },
      tenantRow({ model: 'gpt-unknown' }),
    );

    await expect(
      provider.generateJson([{ role: 'user', content: 'Return JSON.' }], { tenantId: TEST_TENANT_ID }),
    ).rejects.toThrow(AiReportingUnavailable);
    await expect(
      provider.generateJson([{ role: 'user', content: 'Return JSON.' }], { tenantId: TEST_TENANT_ID }),
    ).rejects.toThrow('Configured AI model was rejected by the AI provider');
  });

  it('rejects calls without a tenant context', async () => {
    const provider = service({ JWT_SECRET: JWT_SECRET_32 }, tenantRow());
    await expect(provider.generateJson([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'AI reporting requires a tenant context',
    );
  });
});
