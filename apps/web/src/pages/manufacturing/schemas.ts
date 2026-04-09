import { z } from 'zod';

// ─── Shared helpers ──────────────────────────────────────────────────────────

const uuid = z.string().uuid('Must be a valid ID');

const optionalUuid = z.string().uuid('Must be a valid ID').optional().or(z.literal(''));

const dateString = z
  .string()
  .min(1, 'Date is required')
  .refine((v) => !isNaN(Date.parse(v)), 'Must be a valid date');

const optionalDateString = z
  .string()
  .optional()
  .refine((v) => !v || !isNaN(Date.parse(v)), 'Must be a valid date');

const positiveInt = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number` }).int(`${label} must be a whole number`).positive(`${label} must be > 0`);

const nonNegativeNumber = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number` }).min(0, `${label} must be >= 0`);

// ─── BOM ─────────────────────────────────────────────────────────────────────

export const createBomSchema = z.object({
  productId: uuid.describe('Select a product'),
  bomType: z.string().min(1, 'BOM type is required'),
  revision: z.string().optional(),
  effectiveDate: optionalDateString,
  expiryDate: optionalDateString,
  notes: z.string().optional(),
});
export type CreateBomInput = z.infer<typeof createBomSchema>;

export const updateBomStatusSchema = z.object({
  id: uuid,
  status: z.enum(
    ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'OBSOLETE'],
    { errorMap: () => ({ message: 'Select a valid status' }) },
  ),
});
export type UpdateBomStatusInput = z.infer<typeof updateBomStatusSchema>;

export const addBomComponentSchema = z.object({
  componentProductId: uuid.describe('Select a component product'),
  quantityPer: z.coerce.number().positive('Quantity per must be > 0'),
  uom: z.string().min(1, 'Unit of measure required').default('EA'),
  isPhantom: z.coerce.boolean().default(false),
  wastagePercent: nonNegativeNumber('Wastage %').max(100, 'Wastage cannot exceed 100%').default(0),
});
export type AddBomComponentInput = z.infer<typeof addBomComponentSchema>;

export const copyBomSchema = z.object({
  targetProductId: uuid,
  newRevision: z.string().min(1, 'Revision is required').optional(),
});
export type CopyBomInput = z.infer<typeof copyBomSchema>;

// ─── Work Center ─────────────────────────────────────────────────────────────

export const createWorkCenterSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50, 'Code too long'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().optional(),
  type: z.enum(['MACHINE', 'LABOR', 'ASSEMBLY', 'PACKAGING', 'QUALITY', 'WAREHOUSE'], {
    errorMap: () => ({ message: 'Select a work center type' }),
  }),
  costPerHour: nonNegativeNumber('Cost per hour'),
  efficiencyPercent: z.coerce
    .number()
    .min(0, 'Efficiency must be >= 0%')
    .max(200, 'Efficiency cannot exceed 200%')
    .default(100),
});
export type CreateWorkCenterInput = z.infer<typeof createWorkCenterSchema>;

export const updateWorkCenterSchema = createWorkCenterSchema.partial().omit({ code: true });
export type UpdateWorkCenterInput = z.infer<typeof updateWorkCenterSchema>;

// ─── Capacity ────────────────────────────────────────────────────────────────

export const createCapacitySchema = z
  .object({
    effectiveDate: dateString,
    endDate: optionalDateString,
    standardCapacityPerHour: positiveInt('Standard capacity'),
    maxCapacityPerHour: nonNegativeNumber('Max capacity'),
    availableHoursPerDay: z.coerce.number().min(0.5, 'At least 0.5 h/day').max(24, 'Cannot exceed 24 h'),
    availableDaysPerWeek: z.coerce.number().int().min(1, 'At least 1 day').max(7, 'Cannot exceed 7 days'),
    plannedDowntimePercent: nonNegativeNumber('Downtime %').max(100, 'Cannot exceed 100%').default(0),
  })
  .refine(
    (d) => !d.endDate || new Date(d.endDate) >= new Date(d.effectiveDate),
    { message: 'End date must be after effective date', path: ['endDate'] },
  );
export type CreateCapacityInput = z.infer<typeof createCapacitySchema>;

// ─── Shift ───────────────────────────────────────────────────────────────────

export const createShiftSchema = z.object({
  name: z.string().min(1, 'Shift name is required').max(50),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Use HH:MM format'),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Use HH:MM format'),
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Select at least one day'),
  effectiveDate: dateString,
  breakMinutes: nonNegativeNumber('Break minutes').default(30),
  capacityFactor: z.coerce.number().min(0.01, 'Must be > 0').max(5, 'Cannot exceed 5').default(1),
});
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

// ─── Inventory Policy ────────────────────────────────────────────────────────

export const createInventoryPolicySchema = z.object({
  productId: uuid,
  locationId: optionalUuid,
  planningMethod: z.string().min(1, 'Planning method is required'),
  lotSizingRule: z.string().min(1, 'Lot sizing rule is required'),
  abcClass: z.enum(['A', 'B', 'C']).optional(),
  safetyStockQty: nonNegativeNumber('Safety stock').optional(),
  reorderPoint: nonNegativeNumber('Reorder point').optional(),
  reorderQty: nonNegativeNumber('Reorder quantity').optional(),
  leadTimeDays: nonNegativeNumber('Lead time').optional(),
});
export type CreateInventoryPolicyInput = z.infer<typeof createInventoryPolicySchema>;

// ─── Purchase Order ──────────────────────────────────────────────────────────

export const purchaseOrderLineSchema = z.object({
  productId: uuid.describe('Select a product'),
  quantity: positiveInt('Quantity'),
  unitPrice: nonNegativeNumber('Unit price'),
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;

export const createPurchaseOrderSchema = z.object({
  supplierId: uuid.describe('Select a supplier'),
  expectedDate: dateString,
  lines: z
    .array(purchaseOrderLineSchema)
    .min(1, 'At least one line item is required'),
  notes: z.string().optional(),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

// ─── Goods Receipt ───────────────────────────────────────────────────────────

export const goodsReceiptLineSchema = z.object({
  purchaseOrderLineId: uuid,
  quantity: positiveInt('Quantity'),
  lotNumber: z.string().optional(),
});
export type GoodsReceiptLineInput = z.infer<typeof goodsReceiptLineSchema>;

export const createGoodsReceiptSchema = z.object({
  purchaseOrderId: uuid,
  lines: z
    .array(goodsReceiptLineSchema)
    .min(1, 'At least one line to receive'),
});
export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptSchema>;

// ─── Work Order ──────────────────────────────────────────────────────────────

export const createWorkOrderSchema = z
  .object({
    productId: uuid.describe('Select a product'),
    quantity: positiveInt('Quantity'),
    scheduledStart: dateString,
    scheduledEnd: dateString,
    priority: z.coerce.number().int().min(1, 'Min priority is 1').max(6, 'Max priority is 6').default(5),
    notes: z.string().optional(),
  })
  .refine((d) => new Date(d.scheduledEnd) >= new Date(d.scheduledStart), {
    message: 'End date must be on or after start date',
    path: ['scheduledEnd'],
  });
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

// ─── Production Completion ───────────────────────────────────────────────────

export const reportProductionCompletionSchema = z.object({
  workOrderId: uuid,
  quantity: positiveInt('Completed quantity'),
  scrapQuantity: nonNegativeNumber('Scrap quantity').default(0),
  lotNumber: z.string().optional(),
  notes: z.string().optional(),
});
export type ReportProductionCompletionInput = z.infer<typeof reportProductionCompletionSchema>;

// ─── Labor Entry ─────────────────────────────────────────────────────────────

export const recordLaborEntrySchema = z
  .object({
    operationId: uuid,
    laborType: z.enum(['SETUP', 'RUN', 'TEARDOWN', 'REWORK'], {
      errorMap: () => ({ message: 'Select a labor type' }),
    }),
    startTime: dateString,
    endTime: dateString,
    employeeId: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => new Date(d.endTime) > new Date(d.startTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });
export type RecordLaborEntryInput = z.infer<typeof recordLaborEntrySchema>;

// ─── Material Issue ──────────────────────────────────────────────────────────

export const createMaterialIssueSchema = z.object({
  workOrderId: uuid,
  productId: uuid,
  quantity: positiveInt('Quantity'),
  locationId: optionalUuid,
  lotNumber: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateMaterialIssueInput = z.infer<typeof createMaterialIssueSchema>;

// ─── Supplier ────────────────────────────────────────────────────────────────

export const createSupplierSchema = z.object({
  code: z.string().min(1, 'Supplier code is required').max(50, 'Code too long'),
  name: z.string().min(1, 'Supplier name is required').max(150, 'Name too long'),
  contactName: z.string().optional(),
  contactEmail: z
    .string()
    .email('Enter a valid email')
    .optional()
    .or(z.literal('')),
  contactPhone: z.string().optional(),
  country: z.string().optional(),
  currency: z.string().min(1, 'Currency is required').default('USD'),
  paymentTerms: z.string().min(1, 'Payment terms required').default('NET30'),
  defaultLeadTimeDays: nonNegativeNumber('Lead time').int('Must be whole days').default(14),
  minimumOrderValue: nonNegativeNumber('Minimum order value').default(0),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.omit({ code: true }).partial();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

// ─── Promotion ───────────────────────────────────────────────────────────────

const promotionBaseFields = {
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(150),
  description: z.string().optional(),
  type: z.enum(
    ['DISCOUNT', 'BOGO', 'BUNDLE', 'SEASONAL', 'CLEARANCE', 'TRADE', 'NEW_PRODUCT', 'LOYALTY', 'OTHER'],
    { errorMap: () => ({ message: 'Select a promotion type' }) },
  ),
  startDate: dateString,
  endDate: dateString,
  discountPercent: nonNegativeNumber('Discount %').max(100, 'Cannot exceed 100%').optional(),
  discountAmount: nonNegativeNumber('Discount amount').optional(),
  marketingSpend: nonNegativeNumber('Marketing spend').optional(),
  notes: z.string().optional(),
};

export const createPromotionSchema = z
  .object(promotionBaseFields)
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

export const updatePromotionSchema = z.object(promotionBaseFields).omit({ code: true }).partial();
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

export const copyPromotionSchema = z
  .object({
    code: z.string().min(1, 'New code is required'),
    name: z.string().min(1, 'New name is required'),
    startDate: dateString,
    endDate: dateString,
    copyLiftFactors: z.boolean().default(true),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });
export type CopyPromotionInput = z.infer<typeof copyPromotionSchema>;

// ─── NPI (New Product Introduction) ─────────────────────────────────────────

export const createNpiSchema = z.object({
  sku: z.string().min(1, 'SKU is required').max(50),
  name: z.string().min(1, 'Product name is required').max(150),
  description: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  launchDate: optionalDateString,
  launchCurveType: z.enum(['LINEAR', 'EXPONENTIAL', 'S_CURVE', 'HOCKEY_STICK'], {
    errorMap: () => ({ message: 'Select a launch curve type' }),
  }).default('S_CURVE'),
  rampUpMonths: positiveInt('Ramp-up months').default(6),
  peakMonthsSinceLaunch: positiveInt('Peak month').default(12),
  peakForecastUnits: positiveInt('Peak forecast units').default(1000),
  initialPrice: nonNegativeNumber('Initial price').optional(),
  targetMargin: nonNegativeNumber('Target margin').max(100, 'Cannot exceed 100%').optional(),
});
export type CreateNpiInput = z.infer<typeof createNpiSchema>;

export const updateNpiSchema = createNpiSchema.omit({ sku: true }).partial();
export type UpdateNpiInput = z.infer<typeof updateNpiSchema>;

// ─── Workflow Template ───────────────────────────────────────────────────────

export const createWorkflowTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(100),
  description: z.string().optional(),
  entityType: z.enum(
    ['FORECAST', 'PLAN', 'SCENARIO', 'PURCHASE_ORDER', 'BOM', 'PROMOTION'],
    { errorMap: () => ({ message: 'Select an entity type' }) },
  ),
  thresholdAmount: nonNegativeNumber('Threshold').optional(),
  isActive: z.boolean().default(true),
});
export type CreateWorkflowTemplateInput = z.infer<typeof createWorkflowTemplateSchema>;

export const addWorkflowStepSchema = z.object({
  stepOrder: positiveInt('Step order'),
  name: z.string().min(1, 'Step name is required').max(100),
  approverType: z.enum(['SPECIFIC_USER', 'ROLE', 'MANAGER', 'DEPARTMENT_HEAD'], {
    errorMap: () => ({ message: 'Select an approver type' }),
  }),
  approverRole: z.string().optional(),
  timeoutHours: nonNegativeNumber('Timeout').optional(),
});
export type AddWorkflowStepInput = z.infer<typeof addWorkflowStepSchema>;

// ─── S&OP Cycle ──────────────────────────────────────────────────────────────

export const createSopCycleSchema = z.object({
  name: z.string().optional(),
  year: z.coerce.number().int().min(2000, 'Year too early').max(2100, 'Year too far'),
  month: z.coerce.number().int().min(1, 'Month must be 1–12').max(12, 'Month must be 1–12'),
  description: z.string().optional(),
  horizonMonths: z.coerce.number().int().min(1, 'At least 1 month').max(60, 'Cannot exceed 60 months').default(18),
  demandReviewDate: optionalDateString,
  supplyReviewDate: optionalDateString,
  executiveMeetingDate: optionalDateString,
  demandManagerId: z.string().uuid().optional(),
  supplyManagerId: z.string().uuid().optional(),
  financeManagerId: z.string().uuid().optional(),
  executiveSponsorId: z.string().uuid().optional(),
});
export type CreateSopCycleInput = z.infer<typeof createSopCycleSchema>;

export const createSopAssumptionSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  assumption: z.string().min(1, 'Assumption text is required').max(500),
  impactDescription: z.string().optional(),
  quantitativeImpact: nonNegativeNumber('Impact').optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], {
    errorMap: () => ({ message: 'Select a risk level' }),
  }).default('MEDIUM'),
  mitigationPlan: z.string().optional(),
  owner: z.string().optional(),
  dueDate: optionalDateString,
});
export type CreateSopAssumptionInput = z.infer<typeof createSopAssumptionSchema>;

// ─── Fiscal Calendar ─────────────────────────────────────────────────────────

export const createFiscalCalendarSchema = z.object({
  name: z.string().min(1, 'Calendar name is required').max(100),
  code: z.string().min(1, 'Code is required').max(20, 'Code too long'),
  type: z.enum(['CALENDAR', 'FISCAL_445', 'FISCAL_454', 'FISCAL_544', 'WEEKLY', 'CUSTOM'], {
    errorMap: () => ({ message: 'Select a calendar type' }),
  }),
  yearStartMonth: z.coerce.number().int().min(1).max(12, 'Month must be 1–12'),
  description: z.string().optional(),
});
export type CreateFiscalCalendarInput = z.infer<typeof createFiscalCalendarSchema>;

export const createFiscalPeriodSchema = z
  .object({
    fiscalYear: z.coerce.number().int().min(2000).max(2100),
    fiscalQuarter: z.coerce.number().int().min(1, 'Quarter must be 1–4').max(4, 'Quarter must be 1–4'),
    fiscalMonth: z.coerce.number().int().min(1, 'Month must be 1–12').max(12, 'Month must be 1–12'),
    periodName: z.string().min(1, 'Period name is required').max(50),
    startDate: dateString,
    endDate: dateString,
    workingDays: nonNegativeNumber('Working days').int('Must be whole days').optional(),
    isOpen: z.boolean().default(true),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });
export type CreateFiscalPeriodInput = z.infer<typeof createFiscalPeriodSchema>;

// ─── Inventory Transactions ──────────────────────────────────────────────────

export const inventoryAdjustmentSchema = z.object({
  productId: uuid.describe('Select a product'),
  quantity: z.coerce.number({ invalid_type_error: 'Must be a number' }).refine(
    (v) => v !== 0,
    'Quantity cannot be zero',
  ),
  reason: z.string().min(1, 'Reason is required').max(500),
});
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentSchema>;

export const inventoryTransferSchema = z.object({
  productId: uuid.describe('Select a product'),
  quantity: positiveInt('Quantity'),
  fromLocation: z.string().min(1, 'Source location is required'),
  toLocation: z.string().min(1, 'Destination location is required'),
  notes: z.string().optional(),
}).refine((d) => d.fromLocation !== d.toLocation, {
  message: 'Source and destination must be different',
  path: ['toLocation'],
});
export type InventoryTransferInput = z.infer<typeof inventoryTransferSchema>;

// ─── Utility: extract first error message from ZodError ──────────────────────

/**
 * Extracts a flat map of field → first error message from a Zod safeParse result.
 * Usage:
 * ```ts
 * const result = schema.safeParse(formData);
 * if (!result.success) {
 *   const errors = flattenErrors(result.error);
 *   // errors = { productId: 'Select a product', quantity: 'Quantity must be > 0' }
 * }
 * ```
 */
export function flattenErrors(error: z.ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!map[key]) {
      map[key] = issue.message;
    }
  }
  return map;
}
