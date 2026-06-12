import { AiProviderService } from './ai-provider.service';
import { AiReportingUnavailable } from './ai-reporting.errors';

/**
 * Billing gate contract for the AI execution pipeline:
 *  - enforcement ON + empty central registry  → AI is unavailable (the legacy
 *    per-tenant config must NEVER run unbilled).
 *  - enforcement OFF + empty central registry → legacy fallback still works
 *    (transition deployments).
 *  - central target resolved → the charge lifecycle wraps the call
 *    (prepare before fetch, settle with token usage after).
 */
describe('AiProviderService billing gate', () => {
  const messages = [{ role: 'user' as const, content: 'hello' }];
  const tenantId = '11111111-1111-4111-8111-111111111111';

  const config = { get: jest.fn().mockReturnValue(undefined) } as any;

  const legacyRow = {
    id: 'cfg-1', tenant_id: tenantId, provider: 'openai', model: 'gpt-4o-mini', summary_model: null,
    api_key_encrypted: 'enc', api_key_last4: 'k123', api_key_fingerprint: 'fp', endpoint_url: null,
    organization_id: null, enabled: true, max_tokens: 500, temperature: 0,
    monthly_token_limit: null, monthly_cost_limit_cents: null,
    input_token_cost_per_1m_cents: null, output_token_cost_per_1m_cents: null,
    timeout_ms: 120000, max_result_rows: 500, max_summary_rows: 50,
    daily_user_call_limit: 100, daily_tenant_call_limit: 2000, monthly_company_call_limit: 5000,
    mask_sensitive_fields: true, summaries_enabled: true,
    rate_per_user_per_minute: 20, rate_per_tenant_per_hour: 500,
    max_concurrent_per_user: 2, max_concurrent_per_tenant: 20,
    last_tested_at: null, last_test_status: null, last_test_error: null, updated_at: null,
  };

  function prismaMock() {
    return {
      $queryRawUnsafe: jest.fn().mockResolvedValue([legacyRow]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    } as any;
  }

  const openAiResponse = {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"status":"ok"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('blocks AI entirely when enforcement is ON and the central registry is empty (no unbilled legacy path)', async () => {
    const registry = { resolveExecutionTarget: jest.fn().mockResolvedValue(null) } as any;
    const charge = { enforcementEnabled: jest.fn().mockReturnValue(true), prepare: jest.fn(), settle: jest.fn() } as any;
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('must not be called'));

    const service = new AiProviderService(config, prismaMock(), registry, charge);
    await expect(
      service.generateJson(messages, { tenantId, userId: 'user-1' }),
    ).rejects.toBeInstanceOf(AiReportingUnavailable);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(charge.prepare).not.toHaveBeenCalled();
  });

  it('keeps the legacy fallback when enforcement is OFF (transition mode)', async () => {
    const registry = { resolveExecutionTarget: jest.fn().mockResolvedValue(null) } as any;
    const charge = { enforcementEnabled: jest.fn().mockReturnValue(false), prepare: jest.fn(), settle: jest.fn() } as any;
    jest.spyOn(global, 'fetch' as any).mockResolvedValue(openAiResponse as any);
    // Legacy key decryption is exercised elsewhere; bypass it here.
    jest.spyOn(AiProviderService.prototype as any, 'decryptSecret').mockReturnValue('sk-legacy');

    const service = new AiProviderService(config, prismaMock(), registry, charge);
    await expect(service.generateJson(messages, { tenantId, userId: 'user-1' })).resolves.toEqual({ status: 'ok' });
    // Legacy path is unmetered by the billing platform — prepare never runs.
    expect(charge.prepare).not.toHaveBeenCalled();
  });

  it('wraps central-registry calls in the prepare → settle charge lifecycle', async () => {
    const registry = {
      resolveExecutionTarget: jest.fn().mockResolvedValue({
        provider: { id: 'prov-1', name: 'OpenAI', kind: 'openai', apiKey: 'sk-central', endpointUrl: null, organizationId: null },
        model: { id: 'model-1', modelCode: 'gpt-4o', displayName: 'GPT-4o', maxContext: null },
      }),
    } as any;
    const ticket = { billed: true, reservationId: 'res-1', tenantId, modelCode: 'gpt-4o' };
    const charge = {
      enforcementEnabled: jest.fn().mockReturnValue(true),
      prepare: jest.fn().mockResolvedValue(ticket),
      settle: jest.fn().mockResolvedValue(undefined),
    } as any;
    jest.spyOn(global, 'fetch' as any).mockResolvedValue(openAiResponse as any);

    const service = new AiProviderService(config, prismaMock(), registry, charge);
    await expect(service.generateJson(messages, { tenantId, userId: 'user-1' })).resolves.toEqual({ status: 'ok' });

    expect(charge.prepare).toHaveBeenCalledWith(expect.objectContaining({
      tenantId, modelId: 'model-1', modelCode: 'gpt-4o', providerId: 'prov-1',
    }));
    expect(charge.settle).toHaveBeenCalledWith(ticket, expect.objectContaining({
      success: true,
      usage: expect.objectContaining({ promptTokens: 10, completionTokens: 5 }),
    }));
  });

  it('releases the hold (settle success=false) when the provider call fails', async () => {
    const registry = {
      resolveExecutionTarget: jest.fn().mockResolvedValue({
        provider: { id: 'prov-1', name: 'OpenAI', kind: 'openai', apiKey: 'sk-central', endpointUrl: null, organizationId: null },
        model: { id: 'model-1', modelCode: 'gpt-4o', displayName: 'GPT-4o', maxContext: null },
      }),
    } as any;
    const ticket = { billed: true, reservationId: 'res-1', tenantId, modelCode: 'gpt-4o' };
    const charge = {
      enforcementEnabled: jest.fn().mockReturnValue(true),
      prepare: jest.fn().mockResolvedValue(ticket),
      settle: jest.fn().mockResolvedValue(undefined),
    } as any;
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 400, text: async () => 'bad model' } as any);

    const service = new AiProviderService(config, prismaMock(), registry, charge);
    await expect(service.generateJson(messages, { tenantId, userId: 'user-1' })).rejects.toBeInstanceOf(AiReportingUnavailable);
    expect(charge.settle).toHaveBeenCalledWith(ticket, expect.objectContaining({ success: false }));
  });
});
