import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui';
import { ExportFormat, useReportExport } from './shared';

interface ExportToolbarProps {
  reportType: string;
  filters?: Record<string, unknown>;
}

export default function ExportToolbar({ reportType, filters }: ExportToolbarProps) {
  const { exportReport, isExporting } = useReportExport();

  const handleExport = (format: ExportFormat) => {
    exportReport(reportType, format, filters);
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => handleExport('csv')}
        isLoading={isExporting}
        leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
      >
        CSV
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => handleExport('xlsx')}
        isLoading={isExporting}
        leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
      >
        Excel
      </Button>
    </div>
  );
}
