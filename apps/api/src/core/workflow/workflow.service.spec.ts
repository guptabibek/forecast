import { describe, expect, it, jest } from '@jest/globals';
import { ApproverType, WorkflowStatus } from '@prisma/client';
import { WorkflowService } from './workflow.service';

function createMockPrisma(overrides?: Record<string, any>) {
  return {
    workflowTemplate: {
      findFirst: jest.fn(),
    },
    workflowInstance: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    workflowAction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    ...overrides,
  } as any;
}

describe('WorkflowService hardening', () => {
  it('rejects starting workflows when active template has fewer than 3 steps', async () => {
    const prisma = createMockPrisma();
    prisma.workflowTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      steps: [
        { sequence: 1 },
        { sequence: 2 },
      ],
    });

    const service = new WorkflowService(prisma);

    await expect(
      service.startWorkflow('tenant-1', 'BOM' as any, 'entity-1', 'user-1', 'submit'),
    ).rejects.toThrow('at least 3 approval steps');
  });

  it('rejects duplicate approval by same user at same step', async () => {
    const prisma = createMockPrisma();
    prisma.workflowInstance.findFirst.mockResolvedValue({
      id: 'wf-1',
      tenantId: 'tenant-1',
      status: WorkflowStatus.IN_PROGRESS,
      currentStep: 1,
      template: {
        steps: [
          {
            sequence: 1,
            approverType: ApproverType.USER,
            approverRole: null,
            approverUserId: 'user-1',
            requiredApprovals: 1,
            canReject: true,
          },
        ],
      },
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1', role: 'ADMIN' });
    prisma.workflowAction.findFirst.mockResolvedValue({ id: 'already-approved' });

    const service = new WorkflowService(prisma);

    await expect(service.approve('wf-1', 'user-1', 'again', 'tenant-1')).rejects.toThrow(
      'already approved the current step',
    );
  });

  it('rejects rejection when current step is not rejectable', async () => {
    const prisma = createMockPrisma();
    prisma.workflowInstance.findFirst.mockResolvedValue({
      id: 'wf-1',
      tenantId: 'tenant-1',
      status: WorkflowStatus.IN_PROGRESS,
      currentStep: 1,
      template: {
        steps: [
          {
            sequence: 1,
            approverType: ApproverType.ROLE,
            approverRole: 'ADMIN',
            approverUserId: null,
            requiredApprovals: 1,
            canReject: false,
          },
        ],
      },
    });

    const service = new WorkflowService(prisma);

    await expect(service.reject('wf-1', 'user-1', 'no', 'tenant-1')).rejects.toThrow(
      'does not allow rejection',
    );
    expect(prisma.workflowAction.create).not.toHaveBeenCalled();
  });
});
