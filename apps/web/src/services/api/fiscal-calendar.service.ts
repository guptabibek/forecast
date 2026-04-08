import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface FiscalCalendar {
  id: string;
  name: string;
  code: string;
  type: 'CALENDAR' | 'FISCAL_445' | 'FISCAL_454' | 'FISCAL_544' | 'WEEKLY' | 'CUSTOM';
  yearStartMonth: number;
  yearStartDay?: number;
  weekStartDay?: number;
  isActive: boolean;
  description?: string;
  periods?: FiscalPeriod[];
}

export interface FiscalPeriod {
  id: string;
  calendarId: string;
  calendar?: FiscalCalendar;
  fiscalYear: number;
  fiscalQuarter: number;
  fiscalMonth: number;
  fiscalWeek?: number;
  periodName: string;
  startDate: string;
  endDate: string;
  workingDays?: number;
  isOpen: boolean;
  isLocked: boolean;
  isClosed: boolean;
  lockedAt?: string;
  lockedById?: string;
  isCurrent?: boolean;
}

export interface DateToFiscal {
  date: string;
  fiscalYear: number;
  fiscalQuarter: number;
  fiscalMonth: number;
  fiscalWeek?: number;
  periodName: string;
  periodId: string;
}

export interface FiscalYearSummary {
  fiscalYear: number;
  quarters: number;
  periods: number;
  startDate: string;
  endDate: string;
  totalWorkingDays: number;
}

// ============================================================================
// Fiscal Calendar Service
// ============================================================================

export const fiscalCalendarService = {
  // Calendars
  async getCalendars(params?: {
    isActive?: boolean;
    type?: string;
  }) {
    const response = await apiClient.get('/manufacturing/fiscal-calendars', { params });
    return response.data;
  },

  async getCalendar(calendarId: string) {
    const response = await apiClient.get(`/manufacturing/fiscal-calendars/${calendarId}`);
    return response.data;
  },

  async getActiveCalendar() {
    const response = await apiClient.get('/manufacturing/fiscal-calendars/active');
    return response.data;
  },

  async createCalendar(dto: {
    name: string;
    code: string;
    type: string;
    yearStartMonth: number;
    yearStartDay?: number;
    weekStartDay?: number;
    description?: string;
  }) {
    const response = await apiClient.post('/manufacturing/fiscal-calendars', dto);
    return response.data;
  },

  async updateCalendar(calendarId: string, dto: Partial<FiscalCalendar>) {
    const response = await apiClient.put(`/manufacturing/fiscal-calendars/${calendarId}`, dto);
    return response.data;
  },

  async setActiveCalendar(calendarId: string) {
    const response = await apiClient.put(`/manufacturing/fiscal-calendars/${calendarId}/activate`);
    return response.data;
  },

  async deleteCalendar(calendarId: string) {
    await apiClient.delete(`/manufacturing/fiscal-calendars/${calendarId}`);
  },

  // Periods
  async getPeriods(calendarId: string, params?: {
    fiscalYear?: number;
    fiscalQuarter?: number;
    fiscalMonth?: number;
    isOpen?: boolean;
    startDateFrom?: string;
    startDateTo?: string;
  }) {
    const response = await apiClient.get(`/manufacturing/fiscal-calendars/${calendarId}/periods`, { params });
    return response.data;
  },

  async getPeriod(periodId: string) {
    const response = await apiClient.get(`/manufacturing/fiscal-periods/${periodId}`);
    return response.data;
  },

  async getCurrentPeriod(calendarId: string) {
    const response = await apiClient.get(`/manufacturing/fiscal-calendars/${calendarId}/periods/current`);
    return response.data;
  },

  async createPeriod(calendarId: string, dto: {
    fiscalYear: number;
    fiscalQuarter: number;
    fiscalMonth: number;
    fiscalWeek?: number;
    periodName: string;
    startDate: string;
    endDate: string;
    workingDays?: number;
    isOpen?: boolean;
  }) {
    const response = await apiClient.post(`/manufacturing/fiscal-calendars/${calendarId}/periods`, dto);
    return response.data;
  },

  async updatePeriod(periodId: string, dto: Partial<FiscalPeriod>) {
    const response = await apiClient.put(`/manufacturing/fiscal-periods/${periodId}`, dto);
    return response.data;
  },

  async togglePeriodStatus(periodId: string) {
    const response = await apiClient.put(`/manufacturing/fiscal-periods/${periodId}/toggle-status`);
    return response.data;
  },

  async deletePeriod(periodId: string) {
    await apiClient.delete(`/manufacturing/fiscal-periods/${periodId}`);
  },

  // Bulk Period Generation
  async generatePeriodsForYear(calendarId: string, dto: {
    fiscalYear: number;
    overwriteExisting?: boolean;
    calculateWorkingDays?: boolean;
    holidays?: string[];
  }) {
    const response = await apiClient.post(`/manufacturing/fiscal-calendars/${calendarId}/generate-periods`, dto);
    return response.data;
  },

  // Date Conversion
  async dateToFiscal(calendarId: string, date: string): Promise<DateToFiscal> {
    const response = await apiClient.get(`/manufacturing/fiscal-calendars/${calendarId}/date-to-fiscal`, {
      params: { date },
    });
    return response.data;
  },

  async datesToFiscal(calendarId: string, dates: string[]): Promise<DateToFiscal[]> {
    const response = await apiClient.post(`/manufacturing/fiscal-calendars/${calendarId}/dates-to-fiscal`, { dates });
    return response.data;
  },

  async fiscalToDateRange(calendarId: string, params: {
    fiscalYear: number;
    fiscalQuarter?: number;
    fiscalMonth?: number;
    fiscalWeek?: number;
  }) {
    const response = await apiClient.get(`/manufacturing/fiscal-calendars/${calendarId}/fiscal-to-date-range`, { params });
    return response.data;
  },

  // Period Range Queries
  async getPeriodRange(calendarId: string, params: {
    startDate: string;
    endDate: string;
  }) {
    const response = await apiClient.get(`/manufacturing/fiscal-calendars/${calendarId}/period-range`, { params });
    return response.data;
  },

  async getFiscalYearSummary(calendarId: string, fiscalYear: number): Promise<FiscalYearSummary> {
    const response = await apiClient.get(`/manufacturing/fiscal-calendars/${calendarId}/years/${fiscalYear}/summary`);
    return response.data;
  },

  // Working Days
  async calculateWorkingDays(calendarId: string, params: {
    startDate: string;
    endDate: string;
    holidays?: string[];
    includeWeekends?: boolean;
  }) {
    const response = await apiClient.post(`/manufacturing/fiscal-calendars/${calendarId}/working-days`, params);
    return response.data;
  },

  // Calendar Types
  async getCalendarTypes() {
    return [
      { value: 'CALENDAR', label: 'Calendar Year', description: 'Standard January-December calendar' },
      { value: 'FISCAL_445', label: '4-4-5 Fiscal', description: '4-4-5 week pattern per quarter' },
      { value: 'FISCAL_454', label: '4-5-4 Fiscal', description: '4-5-4 week pattern per quarter' },
      { value: 'FISCAL_544', label: '5-4-4 Fiscal', description: '5-4-4 week pattern per quarter' },
      { value: 'WEEKLY', label: 'Weekly', description: 'Week-based periods' },
      { value: 'CUSTOM', label: 'Custom', description: 'Manually defined periods' },
    ];
  },

  // ──────────────────────────────────────────────────────────────────
  // Period Locking (Accounting)
  // ──────────────────────────────────────────────────────────────────

  async lockPeriod(periodId: string) {
    const response = await apiClient.post(`/manufacturing/fiscal-periods/${periodId}/lock`);
    return response.data;
  },

  async unlockPeriod(periodId: string) {
    const response = await apiClient.post(`/manufacturing/fiscal-periods/${periodId}/unlock`);
    return response.data;
  },
};

export default fiscalCalendarService;
