export type FilterOperator =
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'isNull'
  | 'isNotNull';

export type FieldType = 'string' | 'number' | 'date' | 'boolean' | 'enum';

export interface FilterDescriptor {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

/** Map of backend field name → its type. Only listed fields can be filtered. */
export type AllowedFields = Record<string, FieldType>;
