import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';

export const WIDGET_SIZES = ['small', 'medium', 'large', 'full'] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

const MAX_DASHBOARDS_PER_USER = 10;
const MAX_WIDGETS_PER_DASHBOARD = 30;
const DEFAULT_DASHBOARD_NAME = 'My Dashboard';

interface UserContext {
  id: string;
  tenantId: string;
  role?: string;
  permissions?: string[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mirrors AiReportingService permission semantics for the dashboard surface. */
  assertViewPermission(user: UserContext) {
    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return;
    const permissions = user.permissions ?? [];
    const allowed = ['reports.ai.view', 'reports.ai.execute', 'reports.ai_reporting.view', 'reports.ai_reporting.execute'];
    if (!allowed.some((permission) => permissions.includes(permission))) {
      throw new ForbiddenException('You do not have permission to use the AI Insights Dashboard');
    }
  }

  async listDashboards(user: UserContext) {
    this.assertViewPermission(user);
    let dashboards = await this.prisma.aiDashboard.findMany({
      where: { tenantId: user.tenantId, userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { widgets: { where: { isActive: true } } } } },
    });
    if (!dashboards.length) {
      await this.prisma.aiDashboard.create({
        data: { tenantId: user.tenantId, userId: user.id, name: DEFAULT_DASHBOARD_NAME, isDefault: true },
      });
      dashboards = await this.prisma.aiDashboard.findMany({
        where: { tenantId: user.tenantId, userId: user.id },
        include: { _count: { select: { widgets: { where: { isActive: true } } } } },
      });
    }
    return dashboards.map((dashboard) => this.toDashboardDto(dashboard));
  }

  async createDashboard(user: UserContext, input: { name: string; description?: string }) {
    this.assertViewPermission(user);
    const count = await this.prisma.aiDashboard.count({ where: { tenantId: user.tenantId, userId: user.id } });
    if (count >= MAX_DASHBOARDS_PER_USER) {
      throw new BadRequestException(`You can have at most ${MAX_DASHBOARDS_PER_USER} dashboards`);
    }
    const dashboard = await this.prisma.aiDashboard.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isDefault: count === 0,
      },
    });
    return this.toDashboardDto({ ...dashboard, _count: { widgets: 0 } });
  }

  async updateDashboard(user: UserContext, dashboardId: string, input: { name?: string; description?: string | null; isDefault?: boolean }) {
    this.assertViewPermission(user);
    const dashboard = await this.requireDashboard(user, dashboardId);
    if (input.isDefault === true) {
      await this.prisma.aiDashboard.updateMany({
        where: { tenantId: user.tenantId, userId: user.id, isDefault: true },
        data: { isDefault: false },
      });
    }
    const updated = await this.prisma.aiDashboard.update({
      where: { id: dashboard.id },
      data: {
        name: input.name?.trim() || undefined,
        description: input.description === undefined ? undefined : input.description?.trim() || null,
        isDefault: input.isDefault === true ? true : undefined,
      },
      include: { _count: { select: { widgets: { where: { isActive: true } } } } },
    });
    return this.toDashboardDto(updated);
  }

  async deleteDashboard(user: UserContext, dashboardId: string) {
    this.assertViewPermission(user);
    const dashboard = await this.requireDashboard(user, dashboardId);
    await this.prisma.aiDashboard.delete({ where: { id: dashboard.id } });
    if (dashboard.isDefault) {
      const next = await this.prisma.aiDashboard.findFirst({
        where: { tenantId: user.tenantId, userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      if (next) await this.prisma.aiDashboard.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { deleted: true };
  }

  async cloneDashboard(user: UserContext, dashboardId: string, name?: string) {
    this.assertViewPermission(user);
    const dashboard = await this.requireDashboard(user, dashboardId);
    const widgets = await this.prisma.aiDashboardWidget.findMany({
      where: { tenantId: user.tenantId, dashboardId: dashboard.id, isActive: true },
      orderBy: { position: 'asc' },
    });
    const cloneName = await this.uniqueDashboardName(user, name?.trim() || `${dashboard.name} (Copy)`);
    const clone = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiDashboard.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          name: cloneName,
          description: dashboard.description,
          isDefault: false,
        },
      });
      for (const widget of widgets) {
        await tx.aiDashboardWidget.create({
          data: {
            tenantId: widget.tenantId,
            userId: user.id,
            dashboardId: created.id,
            widgetType: widget.widgetType,
            title: widget.title,
            question: widget.question,
            sourceRequestId: widget.sourceRequestId,
            semanticQuery: widget.semanticQuery as object,
            vizType: widget.vizType,
            filters: widget.filters as object | undefined,
            size: widget.size,
            position: widget.position,
            refreshIntervalSec: widget.refreshIntervalSec,
          },
        });
      }
      return created;
    });
    return this.toDashboardDto({ ...clone, _count: { widgets: widgets.length } });
  }

  async getWidgets(user: UserContext, dashboardId: string) {
    this.assertViewPermission(user);
    const dashboard = await this.requireDashboard(user, dashboardId);
    const widgets = await this.prisma.aiDashboardWidget.findMany({
      where: { tenantId: user.tenantId, dashboardId: dashboard.id, isActive: true },
      orderBy: { position: 'asc' },
    });
    return {
      dashboard: this.toDashboardDto({ ...dashboard, _count: { widgets: widgets.length } }),
      widgets: widgets.map((widget) => this.toWidgetDto(widget)),
    };
  }

  /**
   * Pins the report behind a successful AI Reporting request. The semantic
   * query is read from the server-side audit trail — the client never
   * supplies query internals, so they cannot be forged.
   */
  async pinReport(
    user: UserContext,
    input: { requestId: string; dashboardId?: string; title?: string; size?: WidgetSize; refreshIntervalSec?: number },
  ) {
    this.assertViewPermission(user);
    const audit = await this.findAuditedQuery(user, input.requestId);
    if (!audit) {
      throw new NotFoundException('No successful AI report found for this request. Run the report again before pinning.');
    }
    if (audit.queryKind !== 'single_report') {
      throw new BadRequestException('Only single reports can be pinned. Pin individual widgets from a dashboard answer instead.');
    }

    const dashboard = input.dashboardId
      ? await this.requireDashboard(user, input.dashboardId)
      : await this.requireDefaultDashboard(user);

    const widgetCount = await this.prisma.aiDashboardWidget.count({
      where: { tenantId: user.tenantId, dashboardId: dashboard.id, isActive: true },
    });
    if (widgetCount >= MAX_WIDGETS_PER_DASHBOARD) {
      throw new BadRequestException(`A dashboard can hold at most ${MAX_WIDGETS_PER_DASHBOARD} widgets`);
    }

    const widget = await this.prisma.aiDashboardWidget.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        dashboardId: dashboard.id,
        title: (input.title?.trim() || audit.semanticQuery?.title || audit.question || 'Pinned Report').slice(0, 200),
        question: audit.question?.slice(0, 1000) ?? null,
        sourceRequestId: input.requestId,
        semanticQuery: audit.semanticQuery as object,
        size: input.size && WIDGET_SIZES.includes(input.size) ? input.size : 'medium',
        position: widgetCount,
        refreshIntervalSec: this.normalizeRefreshInterval(input.refreshIntervalSec),
      },
    });
    return this.toWidgetDto(widget);
  }

  async updateWidget(
    user: UserContext,
    widgetId: string,
    input: { title?: string; size?: WidgetSize; vizType?: string | null; refreshIntervalSec?: number | null },
  ) {
    this.assertViewPermission(user);
    const widget = await this.requireWidget(user, widgetId);
    const updated = await this.prisma.aiDashboardWidget.update({
      where: { id: widget.id },
      data: {
        title: input.title?.trim() ? input.title.trim().slice(0, 200) : undefined,
        size: input.size && WIDGET_SIZES.includes(input.size) ? input.size : undefined,
        vizType: input.vizType === undefined ? undefined : input.vizType,
        refreshIntervalSec:
          input.refreshIntervalSec === undefined ? undefined : this.normalizeRefreshInterval(input.refreshIntervalSec),
      },
    });
    return this.toWidgetDto(updated);
  }

  async duplicateWidget(user: UserContext, widgetId: string) {
    this.assertViewPermission(user);
    const widget = await this.requireWidget(user, widgetId);
    const widgetCount = await this.prisma.aiDashboardWidget.count({
      where: { tenantId: user.tenantId, dashboardId: widget.dashboardId, isActive: true },
    });
    if (widgetCount >= MAX_WIDGETS_PER_DASHBOARD) {
      throw new BadRequestException(`A dashboard can hold at most ${MAX_WIDGETS_PER_DASHBOARD} widgets`);
    }
    const copy = await this.prisma.aiDashboardWidget.create({
      data: {
        tenantId: widget.tenantId,
        userId: widget.userId,
        dashboardId: widget.dashboardId,
        widgetType: widget.widgetType,
        title: `${widget.title} (Copy)`.slice(0, 200),
        question: widget.question,
        sourceRequestId: widget.sourceRequestId,
        semanticQuery: widget.semanticQuery as object,
        vizType: widget.vizType,
        filters: widget.filters as object | undefined,
        size: widget.size,
        position: widgetCount,
        refreshIntervalSec: widget.refreshIntervalSec,
      },
    });
    return this.toWidgetDto(copy);
  }

  async unpinWidget(user: UserContext, widgetId: string) {
    this.assertViewPermission(user);
    const widget = await this.requireWidget(user, widgetId);
    await this.prisma.aiDashboardWidget.delete({ where: { id: widget.id } });
    return { deleted: true };
  }

  async updateLayout(user: UserContext, dashboardId: string, items: Array<{ widgetId: string; position: number; size?: WidgetSize }>) {
    this.assertViewPermission(user);
    const dashboard = await this.requireDashboard(user, dashboardId);
    const widgets = await this.prisma.aiDashboardWidget.findMany({
      where: { tenantId: user.tenantId, dashboardId: dashboard.id, isActive: true },
      select: { id: true },
    });
    const owned = new Set(widgets.map((widget) => widget.id));
    const updates = items.filter((item) => owned.has(item.widgetId));
    await this.prisma.$transaction(
      updates.map((item) =>
        this.prisma.aiDashboardWidget.update({
          where: { id: item.widgetId },
          data: {
            position: Math.max(0, Math.trunc(item.position)),
            size: item.size && WIDGET_SIZES.includes(item.size) ? item.size : undefined,
          },
        }),
      ),
    );
    return this.getWidgets(user, dashboardId);
  }

  async requireWidget(user: UserContext, widgetId: string) {
    const widget = await this.prisma.aiDashboardWidget.findFirst({
      where: { id: widgetId, tenantId: user.tenantId, userId: user.id, isActive: true },
    });
    if (!widget) throw new NotFoundException('Widget not found');
    return widget;
  }

  private async requireDashboard(user: UserContext, dashboardId: string) {
    const dashboard = await this.prisma.aiDashboard.findFirst({
      where: { id: dashboardId, tenantId: user.tenantId, userId: user.id },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');
    return dashboard;
  }

  private async requireDefaultDashboard(user: UserContext) {
    const existing = await this.prisma.aiDashboard.findFirst({
      where: { tenantId: user.tenantId, userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (existing) return existing;
    return this.prisma.aiDashboard.create({
      data: { tenantId: user.tenantId, userId: user.id, name: DEFAULT_DASHBOARD_NAME, isDefault: true },
    });
  }

  private async uniqueDashboardName(user: UserContext, baseName: string) {
    const trimmed = baseName.slice(0, 110);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? trimmed : `${trimmed} ${attempt + 1}`;
      const exists = await this.prisma.aiDashboard.findFirst({
        where: { tenantId: user.tenantId, userId: user.id, name: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    return `${trimmed} ${Date.now()}`;
  }

  private async findAuditedQuery(user: UserContext, requestId: string) {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ question: string; query_kind: string | null; semantic_query: any; status: string }>
    >(
      `
        SELECT question, query_kind, semantic_query, status
        FROM ai_report_query_audits
        WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND request_id = $3::uuid
          AND status = 'success' AND semantic_query IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      user.tenantId,
      user.id,
      requestId,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      question: row.question,
      queryKind: row.query_kind,
      semanticQuery: row.semantic_query,
    };
  }

  private normalizeRefreshInterval(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const seconds = Math.trunc(Number(value));
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    // Floor 60s to protect the database; cap at 24h.
    return Math.min(Math.max(seconds, 60), 86400);
  }

  private toDashboardDto(dashboard: {
    id: string;
    name: string;
    description: string | null;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count?: { widgets: number };
  }) {
    return {
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      isDefault: dashboard.isDefault,
      widgetCount: dashboard._count?.widgets ?? 0,
      createdAt: dashboard.createdAt.toISOString(),
      updatedAt: dashboard.updatedAt.toISOString(),
    };
  }

  private toWidgetDto(widget: {
    id: string;
    dashboardId: string;
    widgetType: string;
    title: string;
    question: string | null;
    vizType: string | null;
    size: string;
    position: number;
    refreshIntervalSec: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: widget.id,
      dashboardId: widget.dashboardId,
      widgetType: widget.widgetType,
      title: widget.title,
      question: widget.question,
      vizType: widget.vizType,
      size: widget.size,
      position: widget.position,
      refreshIntervalSec: widget.refreshIntervalSec,
      createdAt: widget.createdAt.toISOString(),
      updatedAt: widget.updatedAt.toISOString(),
    };
  }
}
