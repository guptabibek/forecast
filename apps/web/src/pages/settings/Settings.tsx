import { Dialog, Switch, Transition } from '@headlessui/react';
import {
    BellIcon,
    BuildingOfficeIcon,
    CloudArrowUpIcon,
    KeyIcon,
    PaintBrushIcon,
    ShieldCheckIcon
} from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { settingsService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Fragment, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { z } from 'zod';

/* --- Backend response shape --- */
interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  subdomain: string | null;
  logoUrl: string | null;
  primaryColor: string;
  timezone: string;
  defaultCurrency: string;
  fiscalYearStart: number;
  dataRetentionDays: number;
  status: string;
  tier: string;
  dateFormat: string;
  defaultForecastModel: string;
  emailNotifications: boolean;
  slackWebhookUrl: string | null;
  ssoEnabled: boolean;
  ssoProvider: string | null;
  // Branding & Appearance
  faviconUrl: string | null;
  brandTagline: string | null;
  accentColor: string;
  sidebarBg: string | null;
  sidebarText: string | null;
  headerBg: string | null;
  headerText: string | null;
  // Typography
  headingFont: string;
  bodyFont: string;
  baseFontSize: number;
  headingWeight: number;
  // Theme & Layout
  defaultTheme: string;
  borderRadius: number;
  compactMode: boolean;
  loginBgUrl: string | null;
  customCss: string | null;
}

/* --- Form validation --- */
const settingsSchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  domain: z.string().optional().nullable(),
  subdomain: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  primaryColor: z.string(),
  timezone: z.string(),
  defaultCurrency: z.string(),
  dateFormat: z.string(),
  fiscalYearStart: z.number().min(1).max(12),
  defaultForecastModel: z.string(),
  emailNotifications: z.boolean(),
  slackWebhookUrl: z.string().url().optional().or(z.literal('')).nullable(),
  ssoEnabled: z.boolean(),
  ssoProvider: z.string().optional().nullable(),
  dataRetentionDays: z.number().min(30).max(3650),
  // Branding & Appearance
  faviconUrl: z.string().optional().nullable(),
  brandTagline: z.string().optional().nullable(),
  accentColor: z.string().optional(),
  sidebarBg: z.string().optional().nullable(),
  sidebarText: z.string().optional().nullable(),
  headerBg: z.string().optional().nullable(),
  headerText: z.string().optional().nullable(),
  // Typography
  headingFont: z.string().optional(),
  bodyFont: z.string().optional(),
  baseFontSize: z.number().min(12).max(20).optional(),
  headingWeight: z.number().min(400).max(900).optional(),
  // Theme & Layout
  defaultTheme: z.string().optional(),
  borderRadius: z.number().min(0).max(16).optional(),
  compactMode: z.boolean().optional(),
  loginBgUrl: z.string().optional().nullable(),
  customCss: z.string().optional().nullable(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

/* --- Static options --- */
const timezones = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'America/Mexico_City', 'America/Toronto',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Sydney', 'Pacific/Auckland',
];

const currencies = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '\u20ac' },
  { code: 'GBP', name: 'British Pound', symbol: '\u00a3' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '\u00a5' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '\u00a5' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'INR', name: 'Indian Rupee', symbol: '\u20b9' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'NPR' },
];

const dateFormats = [
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (EU)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY (DE)' },
];

const forecastModels = [
  { value: 'MOVING_AVERAGE', label: 'Moving Average' },
  { value: 'WEIGHTED_AVERAGE', label: 'Weighted Average' },
  { value: 'LINEAR_REGRESSION', label: 'Linear Regression' },
  { value: 'HOLT_WINTERS', label: 'Holt-Winters' },
  { value: 'SEASONAL_NAIVE', label: 'Seasonal Naive' },
  { value: 'YOY_GROWTH', label: 'Year-over-Year Growth' },
  { value: 'ARIMA', label: 'ARIMA' },
  { value: 'PROPHET', label: 'Prophet' },
  { value: 'AI_HYBRID', label: 'AI Hybrid' },
];

const ssoProviders = ['Okta', 'Azure AD', 'Google Workspace', 'Auth0', 'OneLogin'];

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const tabs = [
  { key: 'general', label: 'General', icon: BuildingOfficeIcon },
  { key: 'appearance', label: 'Appearance', icon: PaintBrushIcon },
  { key: 'notifications', label: 'Notifications', icon: BellIcon },
  { key: 'security', label: 'Security', icon: ShieldCheckIcon },
  { key: 'integrations', label: 'Integrations', icon: CloudArrowUpIcon },
];

const integrationsList = [
  { name: 'Salesforce', description: 'Sync CRM opportunity & pipeline data', category: 'CRM' },
  { name: 'SAP S/4HANA', description: 'Import actuals, master data from SAP', category: 'ERP' },
  { name: 'NetSuite', description: 'Oracle NetSuite ERP integration', category: 'ERP' },
  { name: 'Microsoft Dynamics 365', description: 'CRM & ERP sync', category: 'ERP' },
  { name: 'Snowflake', description: 'Data warehouse connector for analytics', category: 'Data' },
  { name: 'Google Sheets', description: 'Import/export spreadsheets', category: 'Productivity' },
  { name: 'Slack', description: 'Real-time notifications to Slack channels', category: 'Notification' },
  { name: 'Microsoft Teams', description: 'Notifications & workflow approvals', category: 'Notification' },
];

const fontOptions = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Montserrat', 'Nunito',
  'Source Sans 3', 'Raleway', 'Ubuntu', 'Merriweather', 'Playfair Display',
  'DM Sans', 'Work Sans', 'Outfit', 'Plus Jakarta Sans', 'Manrope',
  'IBM Plex Sans', 'Noto Sans', 'Figtree',
];

const fontWeightOptions = [
  { value: 400, label: '400 — Regular' },
  { value: 500, label: '500 — Medium' },
  { value: 600, label: '600 — Semi-Bold' },
  { value: 700, label: '700 — Bold' },
  { value: 800, label: '800 — Extra-Bold' },
  { value: 900, label: '900 — Black' },
];

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System (auto)' },
];

export default function Settings() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('general');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [ssoConfigOpen, setSsoConfigOpen] = useState(false);

  /* --- Data fetching --- */
  const { data: settings, isLoading } = useQuery<TenantSettings>({
    queryKey: ['tenant-settings'],
    queryFn: () => settingsService.fetchSettings(),
  });

  /* --- Mutations --- */
  const updateMutation = useMutation({
    mutationFn: async (data: SettingsFormData) => {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.slackWebhookUrl) payload.slackWebhookUrl = undefined;
      if (!payload.ssoProvider) payload.ssoProvider = undefined;
      if (!payload.domain) payload.domain = undefined;
      if (!payload.subdomain) payload.subdomain = undefined;
      if (!payload.logoUrl) payload.logoUrl = undefined;
      const response = await settingsService.patchSettings(payload);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
      toast.success('Settings saved successfully');
    },
    onError: () => {
      toast.error('Failed to save settings');
    },
  });

  const generateApiKeyMutation = useMutation({
    mutationFn: (keyName: string) => settingsService.quickCreateApiKey(keyName),
    onSuccess: (data) => {
      setGeneratedApiKey(data?.data?.secret || data?.secret || data?.apiKey || JSON.stringify(data));
      toast.success('API key generated');
    },
    onError: () => {
      toast.error('Failed to generate API key');
    },
  });

  /* --- Form --- */
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: '',
      domain: '',
      subdomain: '',
      logoUrl: '',
      primaryColor: '#3B82F6',
      timezone: 'UTC',
      defaultCurrency: 'USD',
      dateFormat: 'MM/DD/YYYY',
      fiscalYearStart: 1,
      defaultForecastModel: 'MOVING_AVERAGE',
      emailNotifications: true,
      slackWebhookUrl: '',
      ssoEnabled: false,
      ssoProvider: '',
      dataRetentionDays: 2555,
      faviconUrl: '',
      brandTagline: '',
      accentColor: '#10B981',
      sidebarBg: '#ffffff',
      sidebarText: '#334155',
      headerBg: '#ffffff',
      headerText: '#0f172a',
      headingFont: 'Inter',
      bodyFont: 'Inter',
      baseFontSize: 14,
      headingWeight: 700,
      defaultTheme: 'light',
      borderRadius: 8,
      compactMode: false,
      loginBgUrl: '',
      customCss: '',
    },
    values: settings
      ? {
          name: settings.name,
          domain: settings.domain || '',
          subdomain: settings.subdomain || '',
          logoUrl: settings.logoUrl || '',
          primaryColor: settings.primaryColor || '#3B82F6',
          timezone: settings.timezone || 'UTC',
          defaultCurrency: settings.defaultCurrency || 'USD',
          dateFormat: settings.dateFormat || 'MM/DD/YYYY',
          fiscalYearStart: settings.fiscalYearStart || 1,
          defaultForecastModel: settings.defaultForecastModel || 'MOVING_AVERAGE',
          emailNotifications: settings.emailNotifications ?? true,
          slackWebhookUrl: settings.slackWebhookUrl || '',
          ssoEnabled: settings.ssoEnabled ?? false,
          ssoProvider: settings.ssoProvider || '',
          dataRetentionDays: settings.dataRetentionDays || 2555,
          // Branding
          faviconUrl: settings.faviconUrl || '',
          brandTagline: settings.brandTagline || '',
          accentColor: settings.accentColor || '#10B981',
          sidebarBg: settings.sidebarBg || '#ffffff',
          sidebarText: settings.sidebarText || '#334155',
          headerBg: settings.headerBg || '#ffffff',
          headerText: settings.headerText || '#0f172a',
          // Typography
          headingFont: settings.headingFont || 'Inter',
          bodyFont: settings.bodyFont || 'Inter',
          baseFontSize: settings.baseFontSize ?? 14,
          headingWeight: settings.headingWeight ?? 700,
          // Theme & Layout
          defaultTheme: settings.defaultTheme || 'light',
          borderRadius: settings.borderRadius ?? 8,
          compactMode: settings.compactMode ?? false,
          loginBgUrl: settings.loginBgUrl || '',
          customCss: settings.customCss || '',
        }
      : undefined,
  });

  const onSubmit = (data: SettingsFormData) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-secondary-500 mt-1">
            Manage your organization&apos;s settings and preferences
          </p>
        </div>
        {settings && (
          <div className="flex items-center gap-2">
            <span className={clsx('badge', settings.status === 'ACTIVE' ? 'badge-success' : 'badge-secondary')}>
              {settings.status}
            </span>
            <span className="badge badge-primary">{settings.tier}</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar Tabs */}
          <div className="lg:w-64 flex-shrink-0">
            <nav className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors text-left',
                    activeTab === tab.key
                      ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600'
                      : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-secondary-600',
                  )}
                >
                  <tab.icon className="w-5 h-5" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1">
            <div className="card p-6 space-y-6">
              {/* General Tab */}
              {activeTab === 'general' && (
                <>
                  <div>
                    <h2 className="text-lg font-semibold mb-4">General Settings</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label">Company Name</label>
                        <input type="text" {...register('name')} className="input w-full" />
                        {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>}
                      </div>
                      <div>
                        <label className="label">Domain</label>
                        <input type="text" {...register('domain')} className="input w-full" placeholder="yourcompany.com" />
                      </div>
                      <div>
                        <label className="label">Subdomain</label>
                        <div className="flex">
                          <input type="text" {...register('subdomain')} className="input w-full rounded-r-none" placeholder="yourcompany" />
                          <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-secondary-300 bg-secondary-50 text-secondary-500 text-sm">.forecast-saas.com</span>
                        </div>
                      </div>
                      <div>
                        <label className="label">Slug</label>
                        <input type="text" value={settings?.slug || ''} disabled className="input w-full bg-secondary-50 cursor-not-allowed" />
                        <p className="text-xs text-secondary-400 mt-1">Cannot be changed</p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-secondary-200 dark:border-secondary-700 pt-6">
                    <h3 className="font-medium mb-4">Regional Settings</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label">Timezone</label>
                        <select {...register('timezone')} className="input w-full">
                          {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Currency</label>
                        <select {...register('defaultCurrency')} className="input w-full">
                          {currencies.map((c) => <option key={c.code} value={c.code}>{c.symbol} {c.name} ({c.code})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Date Format</label>
                        <select {...register('dateFormat')} className="input w-full">
                          {dateFormats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Fiscal Year Start Month</label>
                        <select {...register('fiscalYearStart', { valueAsNumber: true })} className="input w-full">
                          {months.map((month, i) => <option key={month} value={i + 1}>{month}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-secondary-200 dark:border-secondary-700 pt-6">
                    <h3 className="font-medium mb-4">Forecasting Defaults</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label">Default Forecast Model</label>
                        <select {...register('defaultForecastModel')} className="input w-full">
                          {forecastModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <p className="text-sm text-secondary-500 mt-1">Used as default when creating new forecast runs</p>
                      </div>
                      <div>
                        <label className="label">Data Retention (days)</label>
                        <input type="number" {...register('dataRetentionDays', { valueAsNumber: true })} className="input w-full" min={30} max={3650} />
                        {errors.dataRetentionDays && <p className="text-sm text-red-500 mt-1">{errors.dataRetentionDays.message}</p>}
                        <p className="text-sm text-secondary-500 mt-1">Historical data older than this will be archived (30-3650 days)</p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Appearance Tab */}
              {activeTab === 'appearance' && (
                <>
                  <h2 className="text-lg font-semibold mb-2">Appearance & Branding</h2>
                  <p className="text-sm text-secondary-500 mb-6">
                    Customise your application&apos;s look and feel. Changes apply to all users in your organisation.
                  </p>

                  {/* ── Brand Identity ── */}
                  <div className="space-y-6">
                    <div className="border-b border-secondary-200 dark:border-secondary-700 pb-6">
                      <h3 className="font-medium mb-4 flex items-center gap-2">
                        <BuildingOfficeIcon className="w-5 h-5 text-primary-500" />
                        Brand Identity
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Logo */}
                        <div className="md:col-span-2">
                          <label className="label">Logo URL</label>
                          <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-lg bg-secondary-100 dark:bg-secondary-800 flex items-center justify-center overflow-hidden border border-dashed border-secondary-300 dark:border-secondary-600">
                              {settings?.logoUrl ? (
                                <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                              ) : (
                                <BuildingOfficeIcon className="w-8 h-8 text-secondary-400" />
                              )}
                            </div>
                            <div className="flex-1">
                              <input type="text" {...register('logoUrl')} className="input w-full" placeholder="https://example.com/logo.png" />
                              <p className="text-xs text-secondary-400 mt-1">PNG, SVG, or JPEG — recommended 256×256px or larger</p>
                            </div>
                          </div>
                        </div>

                        {/* Favicon */}
                        <div>
                          <label className="label">Favicon URL</label>
                          <input type="text" {...register('faviconUrl')} className="input w-full" placeholder="https://example.com/favicon.ico" />
                          <p className="text-xs text-secondary-400 mt-1">ICO or PNG — 32×32px recommended</p>
                        </div>

                        {/* Tagline */}
                        <div>
                          <label className="label">Brand Tagline</label>
                          <input type="text" {...register('brandTagline')} className="input w-full" placeholder="e.g. Enterprise Forecasting Platform" />
                          <p className="text-xs text-secondary-400 mt-1">Shown below the logo in the sidebar</p>
                        </div>

                        {/* Login Background */}
                        <div className="md:col-span-2">
                          <label className="label">Login Page Background Image</label>
                          <input type="text" {...register('loginBgUrl')} className="input w-full" placeholder="https://example.com/bg.jpg" />
                          <p className="text-xs text-secondary-400 mt-1">Optional background image for the login/register pages</p>
                        </div>
                      </div>
                    </div>

                    {/* ── Color Scheme ── */}
                    <div className="border-b border-secondary-200 dark:border-secondary-700 pb-6">
                      <h3 className="font-medium mb-4 flex items-center gap-2">
                        <PaintBrushIcon className="w-5 h-5 text-primary-500" />
                        Color Scheme
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {/* Primary Color */}
                        <div>
                          <label className="label">Primary Color</label>
                          <Controller
                            name="primaryColor"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input type="color" value={field.value} onChange={field.onChange} className="w-10 h-10 rounded-lg cursor-pointer border border-secondary-200 p-0.5" />
                                <input type="text" value={field.value} onChange={field.onChange} className="input w-28 font-mono text-xs" />
                              </div>
                            )}
                          />
                          <p className="text-xs text-secondary-400 mt-1">Buttons, links, accents</p>
                        </div>

                        {/* Accent Color */}
                        <div>
                          <label className="label">Accent Color</label>
                          <Controller
                            name="accentColor"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input type="color" value={field.value || '#10B981'} onChange={field.onChange} className="w-10 h-10 rounded-lg cursor-pointer border border-secondary-200 p-0.5" />
                                <input type="text" value={field.value || '#10B981'} onChange={field.onChange} className="input w-28 font-mono text-xs" />
                              </div>
                            )}
                          />
                          <p className="text-xs text-secondary-400 mt-1">Success states, highlights</p>
                        </div>

                        {/* Sidebar BG */}
                        <div>
                          <label className="label">Sidebar Background</label>
                          <Controller
                            name="sidebarBg"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input type="color" value={field.value || '#ffffff'} onChange={field.onChange} className="w-10 h-10 rounded-lg cursor-pointer border border-secondary-200 p-0.5" />
                                <input type="text" value={field.value || '#ffffff'} onChange={field.onChange} className="input w-28 font-mono text-xs" />
                              </div>
                            )}
                          />
                        </div>

                        {/* Sidebar Text */}
                        <div>
                          <label className="label">Sidebar Text</label>
                          <Controller
                            name="sidebarText"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input type="color" value={field.value || '#334155'} onChange={field.onChange} className="w-10 h-10 rounded-lg cursor-pointer border border-secondary-200 p-0.5" />
                                <input type="text" value={field.value || '#334155'} onChange={field.onChange} className="input w-28 font-mono text-xs" />
                              </div>
                            )}
                          />
                        </div>

                        {/* Header BG */}
                        <div>
                          <label className="label">Header Background</label>
                          <Controller
                            name="headerBg"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input type="color" value={field.value || '#ffffff'} onChange={field.onChange} className="w-10 h-10 rounded-lg cursor-pointer border border-secondary-200 p-0.5" />
                                <input type="text" value={field.value || '#ffffff'} onChange={field.onChange} className="input w-28 font-mono text-xs" />
                              </div>
                            )}
                          />
                        </div>

                        {/* Header Text */}
                        <div>
                          <label className="label">Header Text</label>
                          <Controller
                            name="headerText"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input type="color" value={field.value || '#0f172a'} onChange={field.onChange} className="w-10 h-10 rounded-lg cursor-pointer border border-secondary-200 p-0.5" />
                                <input type="text" value={field.value || '#0f172a'} onChange={field.onChange} className="input w-28 font-mono text-xs" />
                              </div>
                            )}
                          />
                        </div>
                      </div>

                      {/* Color Previews */}
                      <div className="mt-5 p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
                        <p className="text-xs font-medium text-secondary-500 mb-3">Preview</p>
                        <Controller
                          name="primaryColor"
                          control={control}
                          render={({ field: primary }) => (
                            <Controller
                              name="accentColor"
                              control={control}
                              render={({ field: accent }) => (
                                <div className="flex flex-wrap gap-3">
                                  <span className="inline-flex items-center px-4 py-2 rounded-lg text-white text-sm font-medium shadow-sm" style={{ backgroundColor: primary.value }}>
                                    Primary Button
                                  </span>
                                  <span className="inline-flex items-center px-4 py-2 rounded-lg border-2 text-sm font-medium" style={{ borderColor: primary.value, color: primary.value }}>
                                    Outline
                                  </span>
                                  <span className="inline-flex items-center px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: accent.value || '#10B981' }}>
                                    Accent
                                  </span>
                                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${primary.value}20`, color: primary.value }}>
                                    Badge
                                  </span>
                                </div>
                              )}
                            />
                          )}
                        />
                      </div>
                    </div>

                    {/* ── Typography ── */}
                    <div className="border-b border-secondary-200 dark:border-secondary-700 pb-6">
                      <h3 className="font-medium mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.671 1.09-.085 2.17-.207 3.238-.364 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                        Typography
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                          <label className="label">Heading Font</label>
                          <select {...register('headingFont')} className="input w-full">
                            {fontOptions.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                          <p className="text-xs text-secondary-400 mt-1">Applied to all h1–h6 headings</p>
                        </div>

                        <div>
                          <label className="label">Body Font</label>
                          <select {...register('bodyFont')} className="input w-full">
                            {fontOptions.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                          <p className="text-xs text-secondary-400 mt-1">Applied to all body text, inputs, labels</p>
                        </div>

                        <div>
                          <label className="label">Base Font Size (px)</label>
                          <Controller
                            name="baseFontSize"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min={12}
                                  max={20}
                                  step={1}
                                  value={field.value ?? 14}
                                  onChange={e => field.onChange(Number(e.target.value))}
                                  className="flex-1 accent-primary-500"
                                />
                                <span className="text-sm font-mono w-10 text-center">{field.value ?? 14}px</span>
                              </div>
                            )}
                          />
                        </div>

                        <div>
                          <label className="label">Heading Weight</label>
                          <select
                            {...register('headingWeight', { valueAsNumber: true })}
                            className="input w-full"
                          >
                            {fontWeightOptions.map(w => (
                              <option key={w.value} value={w.value}>{w.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Typography Preview */}
                      <div className="mt-5 p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
                        <p className="text-xs font-medium text-secondary-500 mb-3">Preview</p>
                        <Controller
                          name="headingFont"
                          control={control}
                          render={({ field: hFont }) => (
                            <Controller
                              name="bodyFont"
                              control={control}
                              render={({ field: bFont }) => (
                                <Controller
                                  name="headingWeight"
                                  control={control}
                                  render={({ field: hWeight }) => (
                                    <Controller
                                      name="baseFontSize"
                                      control={control}
                                      render={({ field: bSize }) => (
                                        <div className="space-y-2">
                                          <h2 style={{ fontFamily: `'${hFont.value}', system-ui, sans-serif`, fontWeight: hWeight.value ?? 700, fontSize: `${(bSize.value ?? 14) * 1.5}px` }}>
                                            Dashboard Overview
                                          </h2>
                                          <h3 style={{ fontFamily: `'${hFont.value}', system-ui, sans-serif`, fontWeight: hWeight.value ?? 700, fontSize: `${(bSize.value ?? 14) * 1.25}px` }}>
                                            Revenue Forecast Q4
                                          </h3>
                                          <p style={{ fontFamily: `'${bFont.value}', system-ui, sans-serif`, fontSize: `${bSize.value ?? 14}px` }}>
                                            Your demand forecast for the current period shows a 12.5% increase compared to the previous quarter. Review the detailed breakdown below.
                                          </p>
                                          <p style={{ fontFamily: `'${bFont.value}', system-ui, sans-serif`, fontSize: `${(bSize.value ?? 14) * 0.85}px`, color: '#64748b' }}>
                                            Last updated 2 hours ago · 1,247 data points analysed
                                          </p>
                                        </div>
                                      )}
                                    />
                                  )}
                                />
                              )}
                            />
                          )}
                        />
                      </div>
                    </div>

                    {/* ── Theme & Layout ── */}
                    <div className="border-b border-secondary-200 dark:border-secondary-700 pb-6">
                      <h3 className="font-medium mb-4 flex items-center gap-2">
                        <ShieldCheckIcon className="w-5 h-5 text-primary-500" />
                        Theme &amp; Layout
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                          <label className="label">Default Theme</label>
                          <select {...register('defaultTheme')} className="input w-full">
                            {themeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          <p className="text-xs text-secondary-400 mt-1">Applied when users first visit (can be overridden per-user)</p>
                        </div>

                        <div>
                          <label className="label">Border Radius (px)</label>
                          <Controller
                            name="borderRadius"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min={0}
                                  max={16}
                                  step={1}
                                  value={field.value ?? 8}
                                  onChange={e => field.onChange(Number(e.target.value))}
                                  className="flex-1 accent-primary-500"
                                />
                                <span className="text-sm font-mono w-10 text-center">{field.value ?? 8}px</span>
                              </div>
                            )}
                          />
                          <div className="flex gap-2 mt-2">
                            <Controller
                              name="borderRadius"
                              control={control}
                              render={({ field }) => (
                                <>
                                  <div className="w-8 h-8 border-2 border-secondary-300 cursor-pointer hover:border-primary-500 transition-colors" title="Sharp (0px)" style={{ borderRadius: 0 }} onClick={() => field.onChange(0)} />
                                  <div className="w-8 h-8 border-2 border-secondary-300 cursor-pointer hover:border-primary-500 transition-colors" title="Subtle (4px)" style={{ borderRadius: 4 }} onClick={() => field.onChange(4)} />
                                  <div className="w-8 h-8 border-2 border-secondary-300 cursor-pointer hover:border-primary-500 transition-colors" title="Rounded (8px)" style={{ borderRadius: 8 }} onClick={() => field.onChange(8)} />
                                  <div className="w-8 h-8 border-2 border-secondary-300 cursor-pointer hover:border-primary-500 transition-colors" title="Pill (16px)" style={{ borderRadius: 16 }} onClick={() => field.onChange(16)} />
                                </>
                              )}
                            />
                          </div>
                        </div>

                        <div className="md:col-span-2">
                          <Controller
                            name="compactMode"
                            control={control}
                            render={({ field }) => (
                              <div className="flex items-center justify-between p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
                                <div>
                                  <h4 className="font-medium">Compact Mode</h4>
                                  <p className="text-sm text-secondary-500">
                                    Reduce padding and font sizes for a denser layout — ideal for power users with large displays
                                  </p>
                                </div>
                                <Switch
                                  checked={field.value ?? false}
                                  onChange={field.onChange}
                                  className={clsx(
                                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                                    field.value ? 'bg-primary-500' : 'bg-secondary-300',
                                  )}
                                >
                                  <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', field.value ? 'translate-x-6' : 'translate-x-1')} />
                                </Switch>
                              </div>
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── Advanced / Custom CSS ── */}
                    <div>
                      <h3 className="font-medium mb-4 flex items-center gap-2">
                        <KeyIcon className="w-5 h-5 text-primary-500" />
                        Advanced
                      </h3>
                      <div>
                        <label className="label">Custom CSS</label>
                        <textarea
                          {...register('customCss')}
                          rows={6}
                          className="input w-full font-mono text-xs"
                          placeholder={`/* Override any style */\n.btn-primary {\n  box-shadow: 0 4px 6px rgba(0,0,0,0.1);\n}`}
                        />
                        <p className="text-xs text-secondary-400 mt-1">
                          Injected as a <code>&lt;style&gt;</code> tag. Use with caution — invalid CSS may break the layout.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Notifications Tab */}
              {activeTab === 'notifications' && (
                <>
                  <h2 className="text-lg font-semibold mb-4">Notification Preferences</h2>
                  <div className="space-y-4">
                    <Controller
                      name="emailNotifications"
                      control={control}
                      render={({ field }) => (
                        <div className="flex items-center justify-between p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
                          <div>
                            <h3 className="font-medium">Email Notifications</h3>
                            <p className="text-sm text-secondary-500">
                              Receive email alerts for forecast completions, anomalies, workflow approvals, and inventory warnings
                            </p>
                          </div>
                          <Switch
                            checked={field.value}
                            onChange={field.onChange}
                            className={clsx(
                              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                              field.value ? 'bg-primary-500' : 'bg-secondary-300',
                            )}
                          >
                            <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', field.value ? 'translate-x-6' : 'translate-x-1')} />
                          </Switch>
                        </div>
                      )}
                    />

                    <div className="p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg space-y-3">
                      <h3 className="font-medium">Slack Webhook</h3>
                      <p className="text-sm text-secondary-500">
                        Post real-time notifications to a Slack channel via incoming webhook
                      </p>
                      <input
                        type="url"
                        {...register('slackWebhookUrl')}
                        className="input w-full"
                        placeholder="https://hooks.slack.com/services/T.../B.../..."
                      />
                      {errors.slackWebhookUrl && (
                        <p className="text-sm text-red-500">{errors.slackWebhookUrl.message}</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Security Tab */}
              {activeTab === 'security' && (
                <>
                  <h2 className="text-lg font-semibold mb-4">Security</h2>
                  <div className="space-y-6">
                    <div className="p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">Single Sign-On (SSO)</h3>
                          <p className="text-sm text-secondary-500">
                            {settings?.ssoEnabled
                              ? `Enabled via ${settings.ssoProvider}`
                              : 'Not configured \u2014 users log in with email/password'}
                          </p>
                        </div>
                        <button type="button" className="btn-secondary" onClick={() => setSsoConfigOpen(true)}>
                          Configure SSO
                        </button>
                      </div>
                      <Controller
                        name="ssoEnabled"
                        control={control}
                        render={({ field }) => (
                          <div className="mt-3 flex items-center gap-3">
                            <Switch
                              checked={field.value}
                              onChange={field.onChange}
                              className={clsx(
                                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                                field.value ? 'bg-primary-500' : 'bg-secondary-300',
                              )}
                            >
                              <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', field.value ? 'translate-x-6' : 'translate-x-1')} />
                            </Switch>
                            <span className="text-sm text-secondary-600">{field.value ? 'SSO Enabled' : 'SSO Disabled'}</span>
                          </div>
                        )}
                      />
                    </div>

                    <div className="p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">API Keys</h3>
                          <p className="text-sm text-secondary-500">
                            Generate API keys for programmatic access and external integrations
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsApiKeyModalOpen(true)}
                          className="btn-secondary"
                        >
                          <KeyIcon className="w-4 h-4 mr-2" />
                          Generate Key
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Integrations Tab */}
              {activeTab === 'integrations' && (
                <>
                  <h2 className="text-lg font-semibold mb-4">Integrations</h2>
                  <p className="text-sm text-secondary-500 mb-4">
                    Connect external systems to sync data. Integration endpoints are available through the API.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {integrationsList.map((integration) => (
                      <div key={integration.name} className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-medium">{integration.name}</h3>
                          <span className="text-xs bg-secondary-100 dark:bg-secondary-700 px-2 py-0.5 rounded">{integration.category}</span>
                        </div>
                        <p className="text-sm text-secondary-500 mb-3">{integration.description}</p>
                        <span className="badge badge-secondary">Available via API</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Save Button */}
              <div className="border-t border-secondary-200 dark:border-secondary-700 pt-6 flex justify-end gap-3">
                <button
                  type="submit"
                  disabled={!isDirty || updateMutation.isPending}
                  className="btn-primary"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* SSO Config Dialog */}
      <Transition appear show={ssoConfigOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setSsoConfigOpen(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-secondary-800 p-6 shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-semibold mb-4">Configure SSO Provider</Dialog.Title>
                  <Controller
                    name="ssoProvider"
                    control={control}
                    render={({ field }) => (
                      <div className="space-y-3">
                        <label className="label">SSO Provider</label>
                        <select value={field.value || ''} onChange={field.onChange} className="input w-full">
                          <option value="">Select provider...</option>
                          {ssoProviders.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <p className="text-sm text-secondary-500">
                          After selecting a provider, configure SAML/OIDC settings in your identity provider and enter the callback URL:
                        </p>
                        <div className="p-3 bg-secondary-100 dark:bg-secondary-900 rounded text-sm font-mono break-all">
                          {window.location.origin}/auth/sso/callback
                        </div>
                      </div>
                    )}
                  />
                  <div className="flex justify-end gap-3 mt-6">
                    <button type="button" className="btn-secondary" onClick={() => setSsoConfigOpen(false)}>Close</button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* API Key Modal */}
      <Transition appear show={isApiKeyModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => { setIsApiKeyModalOpen(false); setGeneratedApiKey(null); }}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-secondary-800 p-6 shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-semibold mb-4">API Keys</Dialog.Title>
                  {generatedApiKey ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-green-50 dark:bg-green-900/30 rounded-lg">
                        <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                          Copy your API key now. You won&apos;t be able to see it again.
                        </p>
                        <code className="block p-2 bg-secondary-100 dark:bg-secondary-900 rounded text-sm break-all">
                          {generatedApiKey}
                        </code>
                      </div>
                      <button
                        onClick={() => { navigator.clipboard.writeText(generatedApiKey); toast.success('Copied to clipboard'); }}
                        className="btn-primary w-full"
                      >
                        Copy to Clipboard
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-secondary-500">
                        Generate a new API key for external integrations and programmatic access.
                      </p>
                      <div>
                        <label className="label">Key Name</label>
                        <input id="apiKeyName" type="text" className="input w-full" placeholder="e.g., SAP Integration" defaultValue="" />
                      </div>
                      <button
                        onClick={() => {
                          const keyName = (document.getElementById('apiKeyName') as HTMLInputElement)?.value || 'Unnamed Key';
                          generateApiKeyMutation.mutate(keyName);
                        }}
                        disabled={generateApiKeyMutation.isPending}
                        className="btn-primary w-full"
                      >
                        {generateApiKeyMutation.isPending ? 'Generating...' : 'Generate New API Key'}
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => { setIsApiKeyModalOpen(false); setGeneratedApiKey(null); }}
                    className="btn-secondary w-full mt-4"
                  >
                    Close
                  </button>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
