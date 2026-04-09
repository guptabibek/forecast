import { UomCategory } from '@prisma/client';

export const DEFAULT_TENANT_SETTINGS = {
  dateFormat: 'MM/DD/YYYY',
  defaultForecastModel: 'HOLT_WINTERS',
  features: {
    aiForecasting: true,
    advancedReporting: true,
    scenarioPlanning: true,
  },
} as const;

export const DEFAULT_TENANT_UOMS: ReadonlyArray<{
  code: string;
  name: string;
  symbol?: string;
  category: UomCategory;
  decimals: number;
  isBase: boolean;
  sortOrder: number;
}> = [
  { code: 'EA', name: 'Each', symbol: 'ea', category: UomCategory.COUNT, decimals: 0, isBase: true, sortOrder: 1 },
  { code: 'PR', name: 'Pair', symbol: 'pr', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 2 },
  { code: 'DZ', name: 'Dozen', symbol: 'dz', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 3 },
  { code: 'PKG', name: 'Package', symbol: 'pkg', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 4 },
  { code: 'BOX', name: 'Box', symbol: 'box', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 5 },
  { code: 'CS', name: 'Case', symbol: 'cs', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 6 },
  { code: 'PLT', name: 'Pallet', symbol: 'plt', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 7 },
  { code: 'G', name: 'Gram', symbol: 'g', category: UomCategory.WEIGHT, decimals: 2, isBase: false, sortOrder: 1 },
  { code: 'KG', name: 'Kilogram', symbol: 'kg', category: UomCategory.WEIGHT, decimals: 3, isBase: true, sortOrder: 2 },
  { code: 'MT', name: 'Metric Ton', symbol: 't', category: UomCategory.WEIGHT, decimals: 4, isBase: false, sortOrder: 3 },
  { code: 'OZ', name: 'Ounce', symbol: 'oz', category: UomCategory.WEIGHT, decimals: 2, isBase: false, sortOrder: 4 },
  { code: 'LB', name: 'Pound', symbol: 'lb', category: UomCategory.WEIGHT, decimals: 3, isBase: false, sortOrder: 5 },
  { code: 'MM', name: 'Millimeter', symbol: 'mm', category: UomCategory.LENGTH, decimals: 1, isBase: false, sortOrder: 1 },
  { code: 'CM', name: 'Centimeter', symbol: 'cm', category: UomCategory.LENGTH, decimals: 2, isBase: false, sortOrder: 2 },
  { code: 'M', name: 'Meter', symbol: 'm', category: UomCategory.LENGTH, decimals: 3, isBase: true, sortOrder: 3 },
  { code: 'IN', name: 'Inch', symbol: 'in', category: UomCategory.LENGTH, decimals: 2, isBase: false, sortOrder: 4 },
  { code: 'FT', name: 'Foot', symbol: 'ft', category: UomCategory.LENGTH, decimals: 3, isBase: false, sortOrder: 5 },
  { code: 'ML', name: 'Milliliter', symbol: 'ml', category: UomCategory.VOLUME, decimals: 1, isBase: false, sortOrder: 1 },
  { code: 'L', name: 'Liter', symbol: 'L', category: UomCategory.VOLUME, decimals: 3, isBase: true, sortOrder: 2 },
  { code: 'GAL', name: 'Gallon', symbol: 'gal', category: UomCategory.VOLUME, decimals: 3, isBase: false, sortOrder: 3 },
  { code: 'FLOZ', name: 'Fluid Ounce', symbol: 'fl oz', category: UomCategory.VOLUME, decimals: 2, isBase: false, sortOrder: 4 },
  { code: 'SQM', name: 'Square Meter', symbol: 'm2', category: UomCategory.AREA, decimals: 3, isBase: true, sortOrder: 1 },
  { code: 'SQFT', name: 'Square Foot', symbol: 'ft2', category: UomCategory.AREA, decimals: 3, isBase: false, sortOrder: 2 },
  { code: 'SEC', name: 'Second', symbol: 's', category: UomCategory.TIME, decimals: 0, isBase: false, sortOrder: 1 },
  { code: 'MIN', name: 'Minute', symbol: 'min', category: UomCategory.TIME, decimals: 1, isBase: false, sortOrder: 2 },
  { code: 'HR', name: 'Hour', symbol: 'hr', category: UomCategory.TIME, decimals: 2, isBase: true, sortOrder: 3 },
  { code: 'DAY', name: 'Day', symbol: 'day', category: UomCategory.TIME, decimals: 2, isBase: false, sortOrder: 4 },
];

export const DEFAULT_PRODUCT_CATEGORIES: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  color: string;
  sortOrder: number;
}> = [
  { code: 'RAW_MATERIAL', name: 'Raw Material', description: 'Raw materials and basic inputs', color: '#6366F1', sortOrder: 1 },
  { code: 'COMPONENT', name: 'Component', description: 'Individual components and parts', color: '#8B5CF6', sortOrder: 2 },
  { code: 'SUB_ASSEMBLY', name: 'Sub-Assembly', description: 'Intermediate assemblies', color: '#A855F7', sortOrder: 3 },
  { code: 'FINISHED_GOOD', name: 'Finished Good', description: 'Completed products ready for sale', color: '#10B981', sortOrder: 4 },
  { code: 'PACKAGING', name: 'Packaging', description: 'Packaging materials', color: '#F59E0B', sortOrder: 5 },
  { code: 'CONSUMABLE', name: 'Consumable', description: 'Consumable supplies', color: '#EF4444', sortOrder: 6 },
  { code: 'MRO', name: 'MRO', description: 'Maintenance, Repair and Operations', color: '#06B6D4', sortOrder: 7 },
  { code: 'SERVICE', name: 'Service', description: 'Service and labor items', color: '#84CC16', sortOrder: 8 },
  { code: 'SPARE_PART', name: 'Spare Part', description: 'Spare parts for equipment maintenance', color: '#F97316', sortOrder: 9 },
  { code: 'TOOLING', name: 'Tooling', description: 'Tools, jigs, and fixtures', color: '#64748B', sortOrder: 10 },
];