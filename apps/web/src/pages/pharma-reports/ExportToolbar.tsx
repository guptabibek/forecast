import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  DocumentArrowDownIcon,
  ShareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Menu, Transition } from '@headlessui/react';
import { Fragment, useState } from 'react';
import { Button } from '../../components/ui';
import { reportPdfService, type ReportExportPayload } from '../../services/report-pdf.service';
import { ExportFormat, useReportExport } from './shared';

interface ExportToolbarProps {
  reportType: string;
  filters?: Record<string, unknown>;
  disabled?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onResetView?: () => void;
  hasActiveViewState?: boolean;
  pdfPayload?: ReportExportPayload | null;
}

export default function ExportToolbar({
  reportType,
  filters,
  disabled = false,
  onRefresh,
  isRefreshing = false,
  onResetView,
  hasActiveViewState = false,
  pdfPayload,
}: ExportToolbarProps) {
  const { exportReport, isExporting, exportingFormat } = useReportExport();
  const [isSharing, setIsSharing] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);

  const handleExport = (format: ExportFormat) => {
    if (disabled) return;
    exportReport(reportType, format, filters);
  };

  const handlePdfExport = async () => {
    if (disabled || isPdfExporting) return;
    setIsPdfExporting(true);
    try {
      if (pdfPayload) {
        await reportPdfService.exportPdf(pdfPayload);
      } else {
        await reportPdfService.exportReportPdf(reportType, filters);
      }
    } finally {
      setIsPdfExporting(false);
    }
  };

  const handleWhatsAppShare = async () => {
    if (disabled || isSharing) return;
    setIsSharing(true);
    try {
      if (pdfPayload) {
        await reportPdfService.shareToWhatsApp(pdfPayload);
      } else {
        await reportPdfService.shareReportToWhatsApp(reportType, filters);
      }
    } finally {
      setIsSharing(false);
    }
  };

  const isBusy = isExporting || isPdfExporting || isSharing;

  return (
    <div className="flex items-center gap-2">
      {onRefresh && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={disabled || isRefreshing}
          isLoading={isRefreshing}
          leftIcon={<ArrowPathIcon className="h-4 w-4" />}
        >
          Refresh
        </Button>
      )}
      {onResetView && hasActiveViewState && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onResetView}
          leftIcon={<XMarkIcon className="h-4 w-4" />}
        >
          Reset
        </Button>
      )}

      <Menu as="div" className="relative">
        <Menu.Button
          as="button"
          disabled={disabled || isBusy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-secondary-300 bg-white px-3 py-1.5 text-sm font-medium text-secondary-700 shadow-sm transition-colors hover:bg-secondary-50 disabled:opacity-50 dark:border-secondary-600 dark:bg-secondary-800 dark:text-secondary-200 dark:hover:bg-secondary-700"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          Export
          <ChevronDownIcon className="h-3.5 w-3.5 text-secondary-400" />
        </Menu.Button>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 z-50 mt-1 w-44 origin-top-right rounded-lg border border-secondary-200 bg-white py-1 shadow-lg focus:outline-none dark:border-secondary-700 dark:bg-secondary-800">
            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={() => handleExport('csv')}
                  disabled={isExporting}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm ${active ? 'bg-secondary-50 dark:bg-secondary-700' : ''} ${exportingFormat === 'csv' ? 'text-primary-600' : 'text-secondary-700 dark:text-secondary-200'}`}
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  {exportingFormat === 'csv' ? 'Exporting...' : 'Export CSV'}
                </button>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={() => handleExport('xlsx')}
                  disabled={isExporting}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm ${active ? 'bg-secondary-50 dark:bg-secondary-700' : ''} ${exportingFormat === 'xlsx' ? 'text-primary-600' : 'text-secondary-700 dark:text-secondary-200'}`}
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  {exportingFormat === 'xlsx' ? 'Exporting...' : 'Export Excel'}
                </button>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={handlePdfExport}
                  disabled={isPdfExporting}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm ${active ? 'bg-secondary-50 dark:bg-secondary-700' : ''} ${isPdfExporting ? 'text-primary-600' : 'text-secondary-700 dark:text-secondary-200'}`}
                >
                  <DocumentArrowDownIcon className="h-4 w-4" />
                  {isPdfExporting ? 'Generating...' : 'Export PDF'}
                </button>
              )}
            </Menu.Item>
            <div className="my-1 border-t border-secondary-100 dark:border-secondary-700" />
            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={handleWhatsAppShare}
                  disabled={isSharing}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm ${active ? 'bg-secondary-50 dark:bg-secondary-700' : ''} ${isSharing ? 'text-primary-600' : 'text-secondary-700 dark:text-secondary-200'}`}
                >
                  <ShareIcon className="h-4 w-4" />
                  {isSharing ? 'Sharing...' : 'Share WhatsApp'}
                </button>
              )}
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  );
}
