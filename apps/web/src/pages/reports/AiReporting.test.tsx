// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiReporting from './AiReporting';

interface HoistedMocks {
  aiReportingEnabled: boolean;
  currentUser: {
    role: string;
    permissions: string[];
    moduleAccess: Record<string, boolean>;
  };
  catalog: {
    data: unknown;
    isFetching: boolean;
  };
  history: {
    data: unknown[];
    isLoading: boolean;
    refetch: ReturnType<typeof vi.fn>;
  };
  reportQuery: {
    isPending: boolean;
    error: unknown;
    mutateAsync: ReturnType<typeof vi.fn>;
  };
  dashboardQuery: {
    isPending: boolean;
    error: unknown;
    mutateAsync: ReturnType<typeof vi.fn>;
  };
}

const mocks = vi.hoisted<HoistedMocks>(() => ({
  aiReportingEnabled: true,
  currentUser: {
    role: 'ADMIN',
    permissions: ['reports.ai.view', 'reports.ai.execute', 'reports.ai.dashboard'],
    moduleAccess: { reports: true },
  },
  catalog: {
    data: {
      catalogVersion: '1.0',
      datasets: [{ datasetId: 'sales_items', domain: 'sales', grain: 'item_level', description: 'Sales items' }],
      reportTemplates: [{ templateId: 'top_selling_products', displayName: 'Top Selling Products', synonyms: ['most selling product'] }],
      dashboardTemplates: [{ dashboardId: 'sales_dashboard', displayName: 'Sales Dashboard', synonyms: ['sales dashboard'] }],
    },
    isFetching: false,
  },
  history: {
    data: [{ requestId: 'hist-1', question: 'Salesman-wise sales today', status: 'success', createdAt: '2026-05-13T10:00:00.000Z' }],
    isLoading: false,
    refetch: vi.fn(),
  },
  reportQuery: {
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  },
  dashboardQuery: {
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  },
}));

vi.mock('../../stores/auth.store', () => ({
  useAuthStore: <T,>(selector: (state: { user: HoistedMocks['currentUser'] }) => T) => selector({ user: mocks.currentUser }),
}));

vi.mock('../../hooks/useAiReporting', () => ({
  useAiReportingCatalog: () => mocks.catalog,
  useAiReportingHistory: () => mocks.history,
  useAiReportQuery: () => mocks.reportQuery,
  useAiDashboardQuery: () => mocks.dashboardQuery,
}));

vi.mock('../../components/ThemeProvider', () => ({
  useBranding: () => ({
    settings: {
      aiReporting: { enabled: mocks.aiReportingEnabled },
    },
    isLoading: false,
  }),
}));

vi.mock('react-hot-toast', () => ({ default: vi.fn() }));

vi.mock('../../components/charts', () => ({
  BarChart: ({ data }: { data: unknown[] }) => <div data-testid="bar-chart">bar {data.length}</div>,
  LineChart: ({ data }: { data: unknown[] }) => <div data-testid="line-chart">line {data.length}</div>,
  PieChart: ({ data }: { data: unknown[] }) => <div data-testid="pie-chart">pie {data.length}</div>,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reports/ai']}>
      <Routes>
        <Route path="/reports/ai" element={<AiReporting />} />
        <Route path="/dashboard" element={<div>Dashboard fallback</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AiReporting page', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.currentUser = {
      role: 'ADMIN',
      permissions: ['reports.ai.view', 'reports.ai.execute', 'reports.ai.dashboard'],
      moduleAccess: { reports: true },
    };
    mocks.aiReportingEnabled = true;
    mocks.catalog = {
      data: {
        catalogVersion: '1.0',
        datasets: [{ datasetId: 'sales_items', domain: 'sales', grain: 'item_level', description: 'Sales items' }],
        reportTemplates: [{ templateId: 'top_selling_products', displayName: 'Top Selling Products', synonyms: ['most selling product'] }],
        dashboardTemplates: [{ dashboardId: 'sales_dashboard', displayName: 'Sales Dashboard', synonyms: ['sales dashboard'] }],
      },
      isFetching: false,
    };
    mocks.history = {
      data: [{ requestId: 'hist-1', question: 'Salesman-wise sales today', status: 'success', createdAt: '2026-05-13T10:00:00.000Z' }],
      isLoading: false,
      refetch: vi.fn(),
    };
    mocks.reportQuery = { isPending: false, error: null, mutateAsync: vi.fn().mockResolvedValue({
      requestId: 'req-1',
      status: 'success',
      title: 'Top Selling Products',
      queryKind: 'single_report',
      visualization: { type: 'table' },
      columns: [{ key: 'product_name', label: 'Product Name' }],
      rows: [{ product_name: 'Item A' }],
      summary: 'Item A was the top seller.',
      assumptions: [],
      followUpQuestions: ['Show by value'],
    }) };
    mocks.dashboardQuery = { isPending: false, error: null, mutateAsync: vi.fn().mockResolvedValue({
      requestId: 'req-2',
      status: 'success',
      title: 'Sales Dashboard',
      queryKind: 'dashboard',
      widgets: [],
      assumptions: [],
      followUpQuestions: [],
    }) };
  });

  it('renders the production reporting page, suggestions, and history', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'AI Reporting' })).toBeInTheDocument();
    expect(screen.getByText('Ask questions about your sales, purchases, stock, customers, suppliers, and reports.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'most selling product' })).toBeInTheDocument();
    expect(screen.getAllByText('Salesman-wise sales today').length).toBeGreaterThan(0);
    expect(screen.getByText('Available report areas')).toBeInTheDocument();
  });

  it('validates empty input and prevents duplicate invalid submission', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Enter a report question before running AI reporting.')).toBeInTheDocument();
    expect(mocks.reportQuery.mutateAsync).not.toHaveBeenCalled();
  });

  it('submits report questions with enter-to-submit and renders the returned result', async () => {
    renderPage();
    const input = screen.getByLabelText('Report question');

    await userEvent.type(input, 'Show top selling products this month{enter}');

    await waitFor(() => {
      expect(mocks.reportQuery.mutateAsync).toHaveBeenCalledWith({
        question: 'Show top selling products this month',
        outputMode: 'auto',
        includeSummary: true,
      });
    });
    expect(await screen.findByText('Item A was the top seller.')).toBeInTheDocument();
    expect(screen.getByText('Item A')).toBeInTheDocument();
  });

  it('routes dashboard wording to the dashboard API', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'sales dashboard' }));

    await waitFor(() => {
      expect(mocks.dashboardQuery.mutateAsync).toHaveBeenCalledWith({
        question: 'sales dashboard',
        outputMode: 'auto',
        includeSummary: true,
      });
    });
  });

  it('reruns history and follow-up questions as real API requests', async () => {
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /Salesman-wise sales today/i })[1]);
    await waitFor(() => expect(mocks.reportQuery.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      question: 'Salesman-wise sales today',
    })));

    fireEvent.click(await screen.findByRole('button', { name: 'Show by value' }));
    await waitFor(() => expect(mocks.reportQuery.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      question: 'Show by value',
    })));
  });

  it('shows loading and safe error states', () => {
    mocks.reportQuery = { ...mocks.reportQuery, isPending: true };
    const { container, rerender } = renderPage();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

    mocks.reportQuery = { ...mocks.reportQuery, isPending: false, error: { response: { data: { message: 'Permission denied' } } } };
    rerender(
      <MemoryRouter initialEntries={['/reports/ai']}>
        <Routes>
          <Route path="/reports/ai" element={<AiReporting />} />
          <Route path="/dashboard" element={<div>Dashboard fallback</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Permission denied')).toBeInTheDocument();
  });

  it('redirects users without AI reporting permission', () => {
    mocks.currentUser = { role: 'VIEWER', permissions: [], moduleAccess: { reports: true } };

    renderPage();

    expect(screen.getByText('Dashboard fallback')).toBeInTheDocument();
  });

  it('redirects when the AI reporting feature flag is disabled in tenant settings', () => {
    mocks.aiReportingEnabled = false;

    renderPage();

    expect(screen.getByText('Dashboard fallback')).toBeInTheDocument();
  });
});
