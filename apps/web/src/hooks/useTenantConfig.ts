import { useSettings } from './useSettings';

export function useTenantConfig() {
  const { data: settings } = useSettings();
  const companyType = settings?.companyType ?? 'pharma';
  return {
    companyType,
    isPharma: companyType === 'pharma',
    showSaltColumn: companyType === 'pharma',
    showSaltDimension: companyType === 'pharma',
  };
}
