// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiReportResult } from './AiReportResult';
import type { AiReportResponse } from '../../services/api/ai-reporting.service';

vi.mock('../charts', () => ({
  BarChart: ({ data }: { data: unknown[] }) => <div data-testid="bar-chart">bar {data.length}</div>,
  LineChart: ({ data }: { data: unknown[] }) => <div data-testid="line-chart">line {data.length}</div>,
  PieChart: ({ data }: { data: unknown[] }) => <div data-testid="pie-chart">pie {data.length}</div>,
}));

describe('AiReportResult', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders an initial empty reporting state', () => {
    render(<AiReportResult result={null} onAskFollowUp={vi.fn()} />);

    expect(screen.getByText('Ask a report question')).toBeInTheDocument();
  });

  it('renders table reports with summary, assumptions, and follow-up actions', () => {
    const followUp = vi.fn();
    const result: AiReportResponse = {
      requestId: 'req-1',
      status: 'success',
      title: 'Top Selling Products',
      queryKind: 'single_report',
      visualization: { type: 'table' },
      columns: [
        { key: 'product_name', label: 'Product Name' },
        { key: 'sold_quantity', label: 'Sold Quantity', dataType: 'number' },
      ],
      rows: [{ product_name: 'Item A', sold_quantity: 25 }],
      summary: 'Item A sold 25 units.',
      assumptions: ['Cancelled invoices were excluded.'],
      followUpQuestions: ['Show by sales value'],
    };

    render(<AiReportResult result={result} onAskFollowUp={followUp} />);

    expect(screen.getByText('Top Selling Products')).toBeInTheDocument();
    expect(screen.getByText('Item A sold 25 units.')).toBeInTheDocument();
    expect(screen.getByText('Product Name')).toBeInTheDocument();
    expect(screen.getAllByText('Item A').length).toBeGreaterThan(0);
    expect(screen.getByText('Cancelled invoices were excluded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show by sales value' }));
    expect(followUp).toHaveBeenCalledWith('Show by sales value');
  });

  it('hides internal identifier columns from report tables', () => {
    const result: AiReportResponse = {
      requestId: 'req-ids',
      status: 'success',
      title: 'Customer Product Sales',
      queryKind: 'single_report',
      visualization: { type: 'table' },
      columns: [
        { key: 'product_id', label: 'Product ID' },
        { key: 'customerId', label: 'Customer ID' },
        { key: 'product_name', label: 'Product Name' },
        { key: 'customer_name', label: 'Customer Name' },
        { key: 'net_sales', label: 'Net Sales', dataType: 'currency' },
      ],
      rows: [{
        product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        customerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        product_name: 'Item A',
        customer_name: 'Apollo Pharmacy',
        net_sales: 1250,
      }],
    };

    render(<AiReportResult result={result} onAskFollowUp={vi.fn()} />);

    expect(screen.queryByText('Product ID')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer ID')).not.toBeInTheDocument();
    expect(screen.queryByText('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).not.toBeInTheDocument();
    expect(screen.queryByText('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).not.toBeInTheDocument();
    expect(screen.getByText('Product Name')).toBeInTheDocument();
    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('Apollo Pharmacy')).toBeInTheDocument();
  });

  it('renders chart reports from backend visualization configuration', () => {
    const result: AiReportResponse = {
      requestId: 'req-2',
      status: 'success',
      title: 'Monthly Purchase Summary',
      queryKind: 'single_report',
      mode: 'trend',
      metadata: { metricLabel: 'Net Purchase', groupedBy: 'Month', periodLabel: 'Current Financial Year' },
      kpis: [{ label: 'Total Purchase', value: 1000, dataType: 'currency' }],
      grid: {
        columns: [
          { field: 'month_label', label: 'Month', dataType: 'text' },
          { field: 'net_purchase', label: 'Net Purchase', dataType: 'currency' },
        ],
        rows: [{ month_label: 'May 2026', net_purchase: 1000 }],
        totals: { net_purchase: 1000 },
      },
      chart: {
        enabled: true,
        type: 'line',
        xField: 'month_label',
        yField: 'net_purchase',
        data: [{ month_label: 'May 2026', net_purchase: 1000 }],
      },
    };

    render(<AiReportResult result={result} onAskFollowUp={vi.fn()} />);

    expect(screen.getByTestId('line-chart')).toHaveTextContent('line 1');
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('May 2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-05-01T00:00:00.000Z')).not.toBeInTheDocument();
    expect(screen.getByText('Total Purchase')).toBeInTheDocument();
  });

  it('renders dashboard widgets with KPI and table content', () => {
    const result: AiReportResponse = {
      requestId: 'req-3',
      status: 'success',
      title: 'Sales Dashboard',
      queryKind: 'dashboard',
      widgets: [
        {
          widgetId: 'total-sales',
          title: 'Total Sales',
          visualization: { type: 'kpi' },
          columns: [{ key: 'net_sales', label: 'Net Sales', dataType: 'currency' }],
          rows: [{ net_sales: 12500 }],
          summary: 'Net sales are 12,500.',
        },
        {
          widgetId: 'top-products',
          title: 'Top Products',
          visualization: { type: 'table' },
          columns: [{ key: 'product_name', label: 'Product Name' }],
          rows: [{ product_name: 'Item A' }],
        },
      ],
      assumptions: [],
      followUpQuestions: [],
    };

    render(<AiReportResult result={result} onAskFollowUp={vi.fn()} />);

    expect(screen.getByText('Sales Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Total Sales')).toBeInTheDocument();
    expect(screen.getByText('Net Sales')).toBeInTheDocument();
    expect(screen.getByText('Top Products')).toBeInTheDocument();
    expect(screen.getByText('Item A')).toBeInTheDocument();
  });

  it('renders clarification state without exposing internals', () => {
    render(
      <AiReportResult
        result={{
          requestId: 'req-4',
          status: 'clarification_required',
          title: 'Clarification Required',
          queryKind: 'clarification',
          columns: [],
          rows: [],
          followUpQuestions: ['Do you mean customer-wise or supplier-wise?'],
        }}
        onAskFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText('The report request needs one more detail before it can run.')).toBeInTheDocument();
    expect(screen.queryByText(/select/i)).not.toBeInTheDocument();
  });

  it('renders unsupported capability details from the backend response', () => {
    render(
      <AiReportResult
        result={{
          requestId: 'req-5',
          status: 'unsupported',
          title: 'Unsupported future transaction report',
          queryKind: 'unsupported',
          unsupportedReason: 'Sales transaction reports for 2027 require an approved forecast/projection dataset.',
          errorCode: 'FUTURE_TRANSACTION_UNSUPPORTED',
          missingCapabilities: ['sales_forecast_or_projection_dataset'],
          availableAlternatives: ['Ask for actual sales transactions in a completed period.'],
          recommendedSchemaFix: 'Add an allowed sales forecast/projection dataset to the semantic catalog.',
          columns: [],
          rows: [],
          followUpQuestions: [],
        }}
        onAskFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText('Sales transaction reports for 2027 require an approved forecast/projection dataset.')).toBeInTheDocument();
    expect(screen.getByText('Error code: FUTURE_TRANSACTION_UNSUPPORTED')).toBeInTheDocument();
    expect(screen.getByText('sales_forecast_or_projection_dataset')).toBeInTheDocument();
    expect(screen.getByText('Alternative: Ask for actual sales transactions in a completed period.')).toBeInTheDocument();
    expect(screen.getByText('Schema fix: Add an allowed sales forecast/projection dataset to the semantic catalog.')).toBeInTheDocument();
  });
});
