import { CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAiProviderSettings, useTestAiProviderSettings, useUpdateAiProviderSettings } from '../../hooks/useAiReporting';
import type { AiProviderSettingsUpdate } from '../../services/api/ai-reporting.service';
import { LoadingSpinner } from '../../components/ui';

interface ProviderForm {
  enabled: boolean;
  provider: string;
  model: string;
  customModel: string;
  summaryModel: string;
  apiKey: string;
  clearApiKey: boolean;
  endpointUrl: string;
  organizationId: string;
  maxTokens: string;
  monthlyTokenLimit: string;
  monthlyCostLimitCents: string;
  timeoutMs: string;
  maxResultRows: string;
  maxSummaryRows: string;
  dailyUserCallLimit: string;
  dailyTenantCallLimit: string;
  monthlyCompanyCallLimit: string;
  maskSensitiveFields: boolean;
  summariesEnabled: boolean;
  ratePerUserPerMinute: string;
  ratePerTenantPerHour: string;
  maxConcurrentPerUser: string;
  maxConcurrentPerTenant: string;
}

interface OpenAiModelPreset {
  id: string;
  label: string;
  description: string;
  maxTokens: number;
  inputCostPer1mCents: number;
  outputCostPer1mCents: number;
  supportsTemperature: boolean;
}

const OPENAI_MODELS: OpenAiModelPreset[] = [
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    description: 'Fast and economical. Best default for most reports.',
    maxTokens: 4000,
    inputCostPer1mCents: 15,
    outputCostPer1mCents: 60,
    supportsTemperature: true,
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Higher accuracy, ~15× the cost of mini.',
    maxTokens: 4000,
    inputCostPer1mCents: 250,
    outputCostPer1mCents: 1000,
    supportsTemperature: true,
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    description: 'Newer generation mini model.',
    maxTokens: 4000,
    inputCostPer1mCents: 50,
    outputCostPer1mCents: 200,
    supportsTemperature: true,
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Latest flagship. Highest accuracy at premium cost.',
    maxTokens: 4000,
    inputCostPer1mCents: 500,
    outputCostPer1mCents: 2000,
    supportsTemperature: true,
  },
  {
    id: 'o1-mini',
    label: 'o1 mini (reasoning)',
    description: 'Reasoning-style model. Temperature is fixed by OpenAI.',
    maxTokens: 8000,
    inputCostPer1mCents: 110,
    outputCostPer1mCents: 440,
    supportsTemperature: false,
  },
];

const CUSTOM_MODEL_VALUE = '__custom__';

const emptyForm: ProviderForm = {
  enabled: true,
  provider: 'openai',
  model: 'gpt-4o-mini',
  customModel: '',
  summaryModel: '',
  apiKey: '',
  clearApiKey: false,
  endpointUrl: '',
  organizationId: '',
  maxTokens: '',
  monthlyTokenLimit: '',
  monthlyCostLimitCents: '',
  timeoutMs: '',
  maxResultRows: '',
  maxSummaryRows: '',
  dailyUserCallLimit: '',
  dailyTenantCallLimit: '',
  monthlyCompanyCallLimit: '',
  maskSensitiveFields: true,
  summariesEnabled: true,
  ratePerUserPerMinute: '',
  ratePerTenantPerHour: '',
  maxConcurrentPerUser: '',
  maxConcurrentPerTenant: '',
};

function findPreset(modelId: string | null | undefined): OpenAiModelPreset | undefined {
  if (!modelId) return undefined;
  return OPENAI_MODELS.find((preset) => preset.id === modelId);
}

export function AiProviderSettingsPanel() {
  const settingsQuery = useAiProviderSettings();
  const updateSettings = useUpdateAiProviderSettings();
  const testSettings = useTestAiProviderSettings();
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings) return;
    const savedModel = settings.model || '';
    const matchesPreset = !!findPreset(savedModel);
    setForm({
      // Default to enabled for fresh tenants — server returns enabled:false when
      // unconfigured, but the natural first-save flow expects ON.
      enabled: settings.configured ? settings.enabled : true,
      provider: settings.provider || 'openai',
      model: matchesPreset ? savedModel : (savedModel ? CUSTOM_MODEL_VALUE : 'gpt-4o-mini'),
      customModel: matchesPreset ? '' : savedModel,
      summaryModel: settings.summaryModel || '',
      apiKey: '',
      clearApiKey: false,
      endpointUrl: settings.endpointUrl || '',
      organizationId: settings.organizationId || '',
      maxTokens: stringifyNumber(settings.maxTokens),
      monthlyTokenLimit: stringifyNumber(settings.monthlyTokenLimit),
      monthlyCostLimitCents: stringifyNumber(settings.monthlyCostLimitCents),
      timeoutMs: stringifyNumber(settings.timeoutMs),
      maxResultRows: stringifyNumber(settings.maxResultRows),
      maxSummaryRows: stringifyNumber(settings.maxSummaryRows),
      dailyUserCallLimit: stringifyNumber(settings.dailyUserCallLimit),
      dailyTenantCallLimit: stringifyNumber(settings.dailyTenantCallLimit),
      monthlyCompanyCallLimit: stringifyNumber(settings.monthlyCompanyCallLimit),
      maskSensitiveFields: settings.maskSensitiveFields ?? true,
      summariesEnabled: settings.summariesEnabled ?? true,
      ratePerUserPerMinute: stringifyNumber(settings.ratePerUserPerMinute),
      ratePerTenantPerHour: stringifyNumber(settings.ratePerTenantPerHour),
      maxConcurrentPerUser: stringifyNumber(settings.maxConcurrentPerUser),
      maxConcurrentPerTenant: stringifyNumber(settings.maxConcurrentPerTenant),
    });
  }, [settingsQuery.data]);

  const usage = settingsQuery.data?.usage;
  const tokenLimitPct = useMemo(() => {
    const limit = settingsQuery.data?.monthlyTokenLimit;
    if (!limit || !usage) return null;
    return Math.min(100, Math.round((usage.totalTokens / limit) * 100));
  }, [settingsQuery.data?.monthlyTokenLimit, usage]);

  const selectedPreset = useMemo(() => findPreset(form.model), [form.model]);
  const resolvedModelId = form.model === CUSTOM_MODEL_VALUE ? form.customModel.trim() : form.model;

  const updateField = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!resolvedModelId) {
      toast.error('Please select a model');
      return;
    }
    const preset = findPreset(resolvedModelId);
    const advancedMaxTokens = nullableNumber(form.maxTokens);
    const advancedTokenLimit = nullableNumber(form.monthlyTokenLimit);
    const advancedCostLimit = nullableNumber(form.monthlyCostLimitCents);
    const payload: AiProviderSettingsUpdate = {
      enabled: form.enabled,
      provider: form.provider,
      model: resolvedModelId,
      summaryModel: nullableString(form.summaryModel),
      apiKey: nullableString(form.apiKey),
      clearApiKey: form.clearApiKey,
      endpointUrl: showAdvanced ? nullableString(form.endpointUrl) : null,
      organizationId: showAdvanced ? nullableString(form.organizationId) : null,
      maxTokens: advancedMaxTokens ?? preset?.maxTokens ?? null,
      temperature: preset?.supportsTemperature ? 0 : null,
      monthlyTokenLimit: advancedTokenLimit,
      monthlyCostLimitCents: advancedCostLimit,
      inputTokenCostPer1mCents: preset?.inputCostPer1mCents ?? null,
      outputTokenCostPer1mCents: preset?.outputCostPer1mCents ?? null,
      timeoutMs: nullableNumber(form.timeoutMs),
      maxResultRows: nullableNumber(form.maxResultRows),
      maxSummaryRows: nullableNumber(form.maxSummaryRows),
      dailyUserCallLimit: nullableNumber(form.dailyUserCallLimit),
      dailyTenantCallLimit: nullableNumber(form.dailyTenantCallLimit),
      monthlyCompanyCallLimit: nullableNumber(form.monthlyCompanyCallLimit),
      maskSensitiveFields: form.maskSensitiveFields,
      summariesEnabled: form.summariesEnabled,
      ratePerUserPerMinute: nullableNumber(form.ratePerUserPerMinute),
      ratePerTenantPerHour: nullableNumber(form.ratePerTenantPerHour),
      maxConcurrentPerUser: nullableNumber(form.maxConcurrentPerUser),
      maxConcurrentPerTenant: nullableNumber(form.maxConcurrentPerTenant),
    };

    try {
      await updateSettings.mutateAsync(payload);
      setForm((current) => ({ ...current, apiKey: '', clearApiKey: false }));
      toast.success('AI provider settings saved');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save AI provider settings'));
    }
  };

  const test = async () => {
    try {
      const response = await testSettings.mutateAsync();
      toast.success(response.message || 'AI provider connection verified');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'AI provider connection test failed'));
    }
  };

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-secondary-200 p-4 text-sm text-secondary-600">
        <LoadingSpinner size="sm" />
        Loading AI provider settings
      </div>
    );
  }

  if (settingsQuery.error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Admin permission is required to manage tenant AI provider settings.
      </div>
    );
  }

  const settings = settingsQuery.data;

  return (
    <div className="space-y-5">
      {settings && !settings.configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No AI provider is configured for this tenant. Pick a model and enter your OpenAI API key below to enable AI reporting.
        </div>
      )}
      {settings?.configured && !settings.enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          AI reporting is currently <strong>disabled</strong> for this tenant. Toggle <em>Enable AI Reporting</em> on below and click <em>Save Provider</em> to activate it.
        </div>
      )}

      <div className="rounded-lg border border-secondary-200 p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-medium text-secondary-900">Provider & Credentials</h3>
            <p className="text-sm text-secondary-500">
              {settings?.apiKeyConfigured
                ? `API key configured${settings.apiKeyLast4 ? ` ending ${settings.apiKeyLast4}` : ''}.`
                : 'No tenant API key configured.'}
            </p>
          </div>
          <StatusBadge status={settings?.lastTestStatus} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex items-center justify-between rounded-lg border border-secondary-200 p-4 md:col-span-2">
            <span>
              <span className="block text-sm font-medium text-secondary-900">Enable AI Reporting</span>
              <span className="block text-xs text-secondary-500">Turn off to stop AI reporting calls without removing the API key.</span>
            </span>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => updateField('enabled', event.target.checked)}
              className="h-4 w-4 rounded border-secondary-300 text-primary-600"
            />
          </label>

          <div>
            <label className="label">Provider</label>
            <select
              value={form.provider}
              onChange={(event) => updateField('provider', event.target.value)}
              className="input w-full"
            >
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div>
            <label className="label">Model</label>
            <select
              value={form.model}
              onChange={(event) => updateField('model', event.target.value)}
              className="input w-full"
            >
              {OPENAI_MODELS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value={CUSTOM_MODEL_VALUE}>Custom model…</option>
            </select>
            {selectedPreset && (
              <p className="mt-1 text-xs text-secondary-500">{selectedPreset.description}</p>
            )}
          </div>

          {form.model === CUSTOM_MODEL_VALUE && (
            <div className="md:col-span-2">
              <label className="label">Custom model id</label>
              <input
                type="text"
                value={form.customModel}
                onChange={(event) => updateField('customModel', event.target.value)}
                className="input w-full"
                placeholder="e.g. gpt-4o, o1-mini, ft:gpt-4o-mini:..."
              />
              <p className="mt-1 text-xs text-secondary-500">
                Cost estimates won't be tracked unless you fill in cost-per-1M in Advanced.
              </p>
            </div>
          )}

          <div>
            <label className="label">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => updateField('apiKey', event.target.value)}
              className="input w-full"
              placeholder={settings?.apiKeyConfigured ? 'Leave blank to keep current key' : 'sk-...'}
              autoComplete="off"
            />
          </div>

          <label className="flex items-center gap-2 self-end pb-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={form.clearApiKey}
              onChange={(event) => updateField('clearApiKey', event.target.checked)}
              className="h-4 w-4 rounded border-secondary-300 text-primary-600"
            />
            Clear stored API key on save
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-secondary-200">
        <button
          type="button"
          className="flex w-full items-center justify-between p-4 text-left"
          onClick={() => setShowAdvanced((value) => !value)}
        >
          <span className="font-medium text-secondary-900">Advanced settings</span>
          <span className="flex items-center gap-2 text-sm text-secondary-500">
            <span>{showAdvanced ? 'Hide' : 'Show'}</span>
            {showAdvanced ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
          </span>
        </button>
        {showAdvanced && (
          <div className="space-y-4 border-t border-secondary-200 p-4">
            <p className="text-xs text-secondary-500">
              Most tenants can leave these blank. Defaults are applied automatically based on the selected model.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="label">Summary model (optional)</label>
                <input
                  type="text"
                  value={form.summaryModel}
                  onChange={(event) => updateField('summaryModel', event.target.value)}
                  className="input w-full"
                  placeholder="Leave blank to reuse the main model"
                />
              </div>
              <NumberInput
                label="Max tokens per call (override)"
                value={form.maxTokens}
                onChange={(value) => updateField('maxTokens', value)}
                placeholder={selectedPreset ? String(selectedPreset.maxTokens) : '1500'}
              />
              <NumberInput
                label="Monthly token cap"
                value={form.monthlyTokenLimit}
                onChange={(value) => updateField('monthlyTokenLimit', value)}
                placeholder="No cap"
              />
              <NumberInput
                label="Monthly cost cap (cents)"
                value={form.monthlyCostLimitCents}
                onChange={(value) => updateField('monthlyCostLimitCents', value)}
                placeholder="No cap"
              />
              <div>
                <label className="label">Custom endpoint URL</label>
                <input
                  type="url"
                  value={form.endpointUrl}
                  onChange={(event) => updateField('endpointUrl', event.target.value)}
                  className="input w-full"
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div>
                <label className="label">OpenAI organization id</label>
                <input
                  type="text"
                  value={form.organizationId}
                  onChange={(event) => updateField('organizationId', event.target.value)}
                  className="input w-full"
                  placeholder="org-..."
                />
              </div>
            </div>

            <div className="mt-2 border-t border-secondary-100 pt-4">
              <h4 className="text-sm font-medium text-secondary-900">Limits & guardrails</h4>
              <p className="mt-1 text-xs text-secondary-500">
                Defaults are sensible for most tenants. Increase only after monitoring usage.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <NumberInput
                label="Request timeout (ms)"
                value={form.timeoutMs}
                onChange={(value) => updateField('timeoutMs', value)}
                placeholder="120000"
              />
              <NumberInput
                label="Max rows per AI report"
                value={form.maxResultRows}
                onChange={(value) => updateField('maxResultRows', value)}
                placeholder="500"
              />
              <NumberInput
                label="Max rows sent to summarizer"
                value={form.maxSummaryRows}
                onChange={(value) => updateField('maxSummaryRows', value)}
                placeholder="50"
              />
              <NumberInput
                label="Daily AI calls per user"
                value={form.dailyUserCallLimit}
                onChange={(value) => updateField('dailyUserCallLimit', value)}
                placeholder="100"
              />
              <NumberInput
                label="Daily AI calls per tenant"
                value={form.dailyTenantCallLimit}
                onChange={(value) => updateField('dailyTenantCallLimit', value)}
                placeholder="2000"
              />
              <NumberInput
                label="Monthly AI calls per company"
                value={form.monthlyCompanyCallLimit}
                onChange={(value) => updateField('monthlyCompanyCallLimit', value)}
                placeholder="5000"
              />
              <NumberInput
                label="Rate / user / minute"
                value={form.ratePerUserPerMinute}
                onChange={(value) => updateField('ratePerUserPerMinute', value)}
                placeholder="20"
              />
              <NumberInput
                label="Rate / tenant / hour"
                value={form.ratePerTenantPerHour}
                onChange={(value) => updateField('ratePerTenantPerHour', value)}
                placeholder="500"
              />
              <NumberInput
                label="Concurrent / user"
                value={form.maxConcurrentPerUser}
                onChange={(value) => updateField('maxConcurrentPerUser', value)}
                placeholder="2"
              />
              <NumberInput
                label="Concurrent / tenant"
                value={form.maxConcurrentPerTenant}
                onChange={(value) => updateField('maxConcurrentPerTenant', value)}
                placeholder="20"
              />
            </div>

            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex items-start gap-3 rounded-lg border border-secondary-200 p-3">
                <input
                  type="checkbox"
                  checked={form.maskSensitiveFields}
                  onChange={(event) => updateField('maskSensitiveFields', event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-secondary-300 text-primary-600"
                />
                <span>
                  <span className="block text-sm font-medium text-secondary-900">Mask sensitive fields</span>
                  <span className="block text-xs text-secondary-500">Strip GST/PAN/phone/email from AI prompts and reports.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-secondary-200 p-3">
                <input
                  type="checkbox"
                  checked={form.summariesEnabled}
                  onChange={(event) => updateField('summariesEnabled', event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-secondary-300 text-primary-600"
                />
                <span>
                  <span className="block text-sm font-medium text-secondary-900">AI report summaries</span>
                  <span className="block text-xs text-secondary-500">Allow the result summarizer to generate narratives.</span>
                </span>
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-secondary-200 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="font-medium text-secondary-900">Current Month Usage</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <UsageMetric label="Calls" value={formatInteger(usage?.totalCalls ?? 0)} />
              <UsageMetric label="Tokens" value={formatInteger(usage?.totalTokens ?? 0)} />
              <UsageMetric label="Failures" value={formatInteger(usage?.failedCalls ?? 0)} />
              <UsageMetric label="Cost" value={formatCost(usage?.estimatedCostCents ?? null)} />
            </div>
            {tokenLimitPct != null && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-secondary-500">
                  <span>Token limit</span>
                  <span>{tokenLimitPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary-100">
                  <div className="h-full rounded-full bg-primary-600" style={{ width: `${tokenLimitPct}%` }} />
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={test} disabled={testSettings.isPending || updateSettings.isPending}>
              {testSettings.isPending ? 'Testing...' : 'Test Provider'}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={updateSettings.isPending || !resolvedModelId}
            >
              {updateSettings.isPending ? 'Saving...' : 'Save Provider'}
            </button>
          </div>
        </div>
        {settings?.lastTestError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {settings.lastTestError}
          </div>
        )}
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step = '1',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input w-full"
        placeholder={placeholder}
      />
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-secondary-900">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
        <CheckCircleIcon className="h-4 w-4" />
        Verified
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
        <ExclamationTriangleIcon className="h-4 w-4" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-secondary-100 px-2.5 py-1 text-xs font-medium text-secondary-700">
      Not tested
    </span>
  );
}

function stringifyNumber(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInteger(value: number): string {
  return value.toLocaleString('en-IN');
}

function formatCost(cents: number | null): string {
  if (cents == null) return '-';
  if (cents < 100) return `${formatInteger(cents)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const message = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
    if (Array.isArray(message)) return message.join(' ');
    if (message) return message;
  }
  return fallback;
}
