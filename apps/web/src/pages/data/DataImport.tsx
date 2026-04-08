import type { DataImport, ImportStatus, ImportType } from '@/types';
import {
    ArrowPathIcon,
    CheckCircleIcon,
    CloudArrowUpIcon,
    DocumentArrowDownIcon,
    DocumentTextIcon,
    ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { dataService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';

const importTypes: { type: ImportType; label: string; description: string }[] = [
  {
    type: 'ACTUALS',
    label: 'Actuals Data',
    description: 'Historical sales, revenue, or quantity data',
  },
  {
    type: 'PRODUCTS',
    label: 'Products',
    description: 'Product master data with codes and names',
  },
  {
    type: 'LOCATIONS',
    label: 'Locations',
    description: 'Stores, warehouses, or regions',
  },
  {
    type: 'CUSTOMERS',
    label: 'Customers',
    description: 'Customer master data',
  },
  {
    type: 'ACCOUNTS',
    label: 'Accounts',
    description: 'GL accounts for financial planning',
  },
];

const statusConfig: Record<
  ImportStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  PENDING: {
    label: 'Pending',
    color: 'text-secondary-500',
    icon: ArrowPathIcon,
  },
  VALIDATING: {
    label: 'Validating',
    color: 'text-warning-500',
    icon: ArrowPathIcon,
  },
  PROCESSING: {
    label: 'Processing',
    color: 'text-primary-500',
    icon: ArrowPathIcon,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-success-500',
    icon: CheckCircleIcon,
  },
  FAILED: {
    label: 'Failed',
    color: 'text-error-500',
    icon: ExclamationTriangleIcon,
  },
};

export default function DataImport() {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<ImportType>('ACTUALS');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch import history
  const { data: importsData, isLoading: importsLoading } = useQuery({
    queryKey: ['imports'],
    queryFn: () => dataService.getImports({ pageSize: 20 }),
    refetchInterval: 5000, // Poll for updates
  });

  // Fetch import template
  const { data: template, isLoading: templateLoading } = useQuery({
    queryKey: ['import-template', selectedType],
    queryFn: () => dataService.getImportTemplate(selectedType),
  });

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object') {
      const maybeResponse = error as { response?: { data?: { message?: string } } };
      return maybeResponse.response?.data?.message || fallback;
    }
    return fallback;
  };

  const formatImportError = (error: unknown) => {
    if (error && typeof error === 'object') {
      const maybeError = error as { message?: unknown };
      if (typeof maybeError.message === 'string') {
        return maybeError.message;
      }
      return JSON.stringify(error);
    }
    return String(error ?? 'Unknown error');
  };

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      dataService.uploadFile(selectedType, file, setUploadProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      toast.success('File uploaded successfully! Processing started.');
      setUploadProgress(0);
      setIsUploading(false);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Upload failed'));
      setUploadProgress(0);
      setIsUploading(false);
    },
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setIsUploading(true);
        uploadMutation.mutate(acceptedFiles[0]);
      }
    },
    [uploadMutation],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    disabled: isUploading,
  });

  const handleDownloadTemplate = async () => {
    try {
      const blob = await dataService.downloadTemplate(selectedType);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedType.toLowerCase()}_template.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast.error('Failed to download template');
    }
  };

  const imports: DataImport[] = Array.isArray(importsData) ? importsData : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Import Data</h1>
        <p className="text-secondary-500 mt-1">
          Upload CSV or Excel files to import actuals or dimension data
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Section */}
        <div className="lg:col-span-2 space-y-6">
          {/* Import Type Selection */}
          <div className="card p-6">
            <h3 className="font-semibold mb-4">Select Data Type</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {importTypes.map((item) => (
                <button
                  key={item.type}
                  onClick={() => setSelectedType(item.type)}
                  className={clsx(
                    'p-4 rounded-lg border-2 text-left transition-all',
                    selectedType === item.type
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                      : 'border-secondary-200 hover:border-secondary-300 dark:border-secondary-700',
                  )}
                >
                  <p className="font-medium">{item.label}</p>
                  <p className="text-xs text-secondary-500 mt-1">{item.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Dropzone */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Upload File</h3>
              <button
                onClick={handleDownloadTemplate}
                className="btn-secondary btn-sm"
              >
                <DocumentArrowDownIcon className="w-4 h-4 mr-2" />
                Download Template
              </button>
            </div>

            <div
              {...getRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                isDragActive
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-secondary-300 hover:border-secondary-400 dark:border-secondary-600',
                isUploading && 'pointer-events-none opacity-50',
              )}
            >
              <input {...getInputProps()} />
              <CloudArrowUpIcon className="w-12 h-12 text-secondary-400 mx-auto mb-4" />
              {isDragActive ? (
                <p className="text-primary-600 font-medium">Drop the file here...</p>
              ) : (
                <>
                  <p className="text-secondary-600 font-medium">
                    Drag & drop your file here, or click to browse
                  </p>
                  <p className="text-secondary-400 text-sm mt-2">
                    Supports CSV, XLS, and XLSX files up to 50MB
                  </p>
                </>
              )}
            </div>

            {/* Upload Progress */}
            <AnimatePresence>
              {isUploading && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-secondary-600">Uploading...</span>
                    <span className="text-sm font-medium">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-secondary-200 rounded-full h-2">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Template Preview */}
          <div className="card p-6">
            <h3 className="font-semibold mb-4">Expected Format</h3>
            {templateLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary-500" />
              </div>
            ) : template && template.columns ? (
              <div className="overflow-x-auto">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.columns.map((col) => (
                      <tr key={col.name}>
                        <td className="font-mono">{col.name}</td>
                        <td>
                          <span className="badge badge-primary">{col.type}</span>
                        </td>
                        <td>
                          {col.required ? (
                            <CheckCircleIcon className="w-5 h-5 text-success-500" />
                          ) : (
                            <span className="text-secondary-400">Optional</span>
                          )}
                        </td>
                        <td className="text-secondary-500">{col.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-secondary-500 text-sm">No template information available</p>
            )}
          </div>
        </div>

        {/* Import History */}
        <div className="card h-fit">
          <div className="p-4 border-b border-secondary-200 dark:border-secondary-700">
            <h3 className="font-semibold">Recent Imports</h3>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {importsLoading ? (
              <div className="p-8 flex justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary-500" />
              </div>
            ) : imports.length === 0 ? (
              <div className="p-8 text-center text-secondary-500">
                <DocumentTextIcon className="w-10 h-10 mx-auto mb-2 text-secondary-300" />
                <p>No imports yet</p>
              </div>
            ) : (
              <div className="divide-y divide-secondary-200 dark:divide-secondary-700">
                {imports.map((importItem) => {
                  const status = statusConfig[importItem.status] || statusConfig.PENDING;
                  const StatusIcon = status.icon;
                  const displayType = importItem.importType || importItem.type || 'DATA';

                  return (
                    <div key={importItem.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={clsx(
                              'w-8 h-8 rounded-lg flex items-center justify-center',
                              importItem.status === 'COMPLETED'
                                ? 'bg-success-50'
                                : importItem.status === 'FAILED'
                                ? 'bg-error-50'
                                : 'bg-secondary-100',
                            )}
                          >
                            <StatusIcon
                              className={clsx(
                                'w-4 h-4',
                                status.color,
                                ['PENDING', 'VALIDATING', 'PROCESSING'].includes(
                                  importItem.status,
                                ) && 'animate-spin',
                              )}
                            />
                          </div>
                          <div>
                            <p className="text-sm font-medium truncate max-w-[150px]">
                              {importItem.fileName}
                            </p>
                            <p className="text-xs text-secondary-500">
                              {displayType} • {status.label}
                            </p>
                          </div>
                        </div>
                      </div>

                      {importItem.status === 'PROCESSING' && importItem.totalRows && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-secondary-500 mb-1">
                            <span>Processing</span>
                            <span>
                              {importItem.processedRows || 0} / {importItem.totalRows}
                            </span>
                          </div>
                          <div className="w-full bg-secondary-200 rounded-full h-1.5">
                            <div
                              className="bg-primary-500 h-1.5 rounded-full"
                              style={{
                                width: `${
                                  ((importItem.processedRows || 0) / importItem.totalRows) * 100
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {importItem.status === 'COMPLETED' && (
                        <p className="mt-2 text-xs text-success-600">
                          ✓ {(importItem.successRows || importItem.processedRows || 0).toLocaleString()} rows imported
                          {(importItem.errorRows || 0) > 0 && (
                            <span className="text-warning-600">
                              {' '}
                              ({importItem.errorRows} errors)
                            </span>
                          )}
                        </p>
                      )}

                      {importItem.status === 'FAILED' && importItem.errors?.[0] && (
                        <p className="mt-2 text-xs text-error-600">
                          {formatImportError(importItem.errors[0])}
                        </p>
                      )}

                      <p className="mt-2 text-xs text-secondary-400">
                        {importItem.startedAt 
                          ? format(new Date(importItem.startedAt), 'MMM d, HH:mm')
                          : format(new Date(importItem.createdAt), 'MMM d, HH:mm')}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
