import { describe, expect, it, jest } from '@jest/globals';
import { ApproverType, UserRole, UserStatus, WorkflowActionType, WorkflowStatus } from '@prisma/client';
import { ManufacturingService } from './manufacturing.service';

type MockPrisma = {
  workflowInstance: {
    findMany: any;
  };
  user: {
    findMany: any;
  };
};

type MockContext = {
  service: ManufacturingService;
  prisma: {
    workflowInstance: {
      findMany: any;
    };
    user: {
      findMany: any;
    };
  };
};

function createServiceContext(): MockContext {
  const service = new ManufacturingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const prisma: MockPrisma = {
    workflowInstance: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  };

  (service as any).prisma = prisma;
  return { service, prisma };
}

describe('ManufacturingService workflow analytics', () => {
  it('computes workflow metrics with rates, durations, and action totals', async () => {
    const context = createServiceContext();

    context.prisma.workflowInstance.findMany.mockResolvedValue([
      {
        status: WorkflowStatus.APPROVED,
        submittedAt: new Date('2026-02-01T00:00:00.000Z'),
        completedAt: new Date('2026-02-01T10:00:00.000Z'),
        actions: [{ action: WorkflowActionType.APPROVE }],
      },
      {
        status: WorkflowStatus.REJECTED,
        submittedAt: new Date('2026-02-01T00:00:00.000Z'),
        completedAt: new Date('2026-02-01T04:00:00.000Z'),
        actions: [{ action: WorkflowActionType.REJECT }, { action: WorkflowActionType.RETURN }],
      },
      {
        status: WorkflowStatus.IN_PROGRESS,
        submittedAt: new Date('2026-02-01T00:00:00.000Z'),
        completedAt: null,
        actions: [{ action: WorkflowActionType.DELEGATE }],
      },
    ]);

    const result = await context.service.getWorkflowMetrics('tenant-1', {
      entityType: 'BOM',
      startDate: '2026-02-01T00:00:00.000Z',
      endDate: '2026-02-28T23:59:59.000Z',
    });

    expect(context.prisma.workflowInstance.findMany).toHaveBeenCalled();
    expect(result.total).toBe(3);
    expect(result.statusBreakdown).toEqual({
      inProgress: 1,
      approved: 1,
      rejected: 1,
      cancelled: 0,
      onHold: 0,
    });
    expect(result.approvalRate).toBeCloseTo(33.33, 2);
    expect(result.rejectionRate).toBeCloseTo(33.33, 2);
    expect(result.averageCompletionHours).toBe(7);
    expect(result.actionCounts).toEqual({
      approvals: 1,
      rejections: 1,
      returns: 1,
      delegations: 1,
    });
  });

  it('rejects invalid metrics date filters', async () => {
    const context = createServiceContext();

    await expect(
      context.service.getWorkflowMetrics('tenant-1', {
        startDate: 'not-a-date',
      }),
    ).rejects.toThrow('startDate must be a valid ISO date');
    expect(context.prisma.workflowInstance.findMany).not.toHaveBeenCalled();
  });

  it('computes approver workload from active workflow steps', async () => {
    const context = createServiceContext();

    context.prisma.user.findMany.mockResolvedValue([
      { id: 'admin-1', role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      { id: 'planner-1', role: UserRole.PLANNER, status: UserStatus.ACTIVE },
      { id: 'finance-1', role: UserRole.FINANCE, status: UserStatus.ACTIVE },
      { id: 'viewer-1', role: UserRole.VIEWER, status: UserStatus.ACTIVE },
    ]);

    context.prisma.workflowInstance.findMany.mockResolvedValue([
      {
        currentStep: 1,
        template: {
          steps: [
            {
              sequence: 1,
              approverType: ApproverType.USER,
              approverUserId: 'planner-1',
              approverRole: null,
            },
          ],
        },
      },
      {
        currentStep: 2,
        template: {
          steps: [
            {
              sequence: 2,
              approverType: ApproverType.ROLE,
              approverUserId: null,
              approverRole: UserRole.FINANCE,
            },
          ],
        },
      },
      {
        currentStep: 3,
        template: {
          steps: [
            {
              sequence: 3,
              approverType: ApproverType.MANAGER,
              approverUserId: null,
              approverRole: null,
            },
          ],
        },
      },
      {
        currentStep: 4,
        template: {
          steps: [
            {
              sequence: 4,
              approverType: ApproverType.DYNAMIC,
              approverUserId: null,
              approverRole: null,
            },
          ],
        },
      },
    ]);

    const result = await context.service.getApproverWorkload('tenant-1');

    expect(result.totalPendingInstances).toBe(4);
    expect(result.totalApprovers).toBe(3);

    const workloadByUser = new Map(result.approverWorkload.map((item: { userId: string; pendingApprovals: number }) => [item.userId, item.pendingApprovals]));
    expect(workloadByUser.get('planner-1')).toBe(2);
    expect(workloadByUser.get('finance-1')).toBe(2);
    expect(workloadByUser.get('admin-1')).toBe(2);
    expect(workloadByUser.has('viewer-1')).toBe(false);
  });
});
