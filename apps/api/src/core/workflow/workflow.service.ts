import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApproverType, WorkflowActionType, WorkflowEntityType, WorkflowStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WorkflowService {
  private static readonly MIN_APPROVAL_STEPS = 3;

  constructor(private readonly prisma: PrismaService) {}

  async startWorkflow(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
    submittedBy: string,
    notes?: string,
  ) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { tenantId, entityType, isActive: true },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    if (!template) {
      throw new BadRequestException(`No active workflow template for ${entityType}`);
    }

    this.assertTemplateStepsIntegrity(template.steps.map((step) => ({ sequence: step.sequence })));

    if (template.steps.length < WorkflowService.MIN_APPROVAL_STEPS) {
      throw new BadRequestException(
        `Workflow template must define at least ${WorkflowService.MIN_APPROVAL_STEPS} approval steps`,
      );
    }

    const activeInstance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId,
        entityType,
        entityId,
        status: { in: [WorkflowStatus.IN_PROGRESS, WorkflowStatus.ON_HOLD] },
      },
      select: { id: true },
    });

    if (activeInstance) {
      throw new BadRequestException('An active workflow already exists for this entity');
    }

    const firstStep = template.steps[0];

    const instance = await this.prisma.workflowInstance.create({
      data: {
        tenantId,
        templateId: template.id,
        entityType,
        entityId,
        status: WorkflowStatus.IN_PROGRESS,
        currentStep: firstStep.sequence,
        submittedBy,
        submittedAt: new Date(),
        notes,
      },
    });

    await this.prisma.workflowAction.create({
      data: {
        instanceId: instance.id,
        stepNumber: firstStep.sequence,
        action: WorkflowActionType.SUBMIT,
        performedBy: submittedBy,
        comments: notes,
      },
    });

    return instance;
  }

  async approve(instanceId: string, userId: string, comments?: string, tenantId?: string) {
    const instance = await this.getInstanceWithTemplate(instanceId, tenantId);

    if (instance.status !== WorkflowStatus.IN_PROGRESS) {
      throw new BadRequestException('Workflow is not in progress');
    }

    const currentStep = instance.template.steps.find(
      (step) => step.sequence === instance.currentStep,
    );

    if (!currentStep) {
      throw new NotFoundException('Workflow step not found');
    }

    await this.assertApprover(
      instance.tenantId,
      currentStep.approverType,
      currentStep.approverRole,
      currentStep.approverUserId,
      userId,
    );

    const existingApproval = await this.prisma.workflowAction.findFirst({
      where: {
        instanceId: instance.id,
        stepNumber: currentStep.sequence,
        action: WorkflowActionType.APPROVE,
        performedBy: userId,
      },
      select: { id: true },
    });

    if (existingApproval) {
      throw new BadRequestException('User has already approved the current step');
    }

    await this.prisma.workflowAction.create({
      data: {
        instanceId: instance.id,
        stepNumber: currentStep.sequence,
        action: WorkflowActionType.APPROVE,
        performedBy: userId,
        comments,
      },
    });

    const approvals = await this.prisma.workflowAction.findMany({
      where: {
        instanceId: instance.id,
        stepNumber: currentStep.sequence,
        action: WorkflowActionType.APPROVE,
      },
      select: { performedBy: true },
    });

    const uniqueApprovals = new Set(approvals.map((approval) => approval.performedBy)).size;

    const steps = instance.template.steps;
    const isLastStep = currentStep.sequence === steps[steps.length - 1].sequence;

    if (uniqueApprovals >= currentStep.requiredApprovals) {
      if (isLastStep) {
        return this.prisma.workflowInstance.update({
          where: { id: instance.id },
          data: {
            status: WorkflowStatus.APPROVED,
            completedAt: new Date(),
          },
        });
      }

      return this.prisma.workflowInstance.update({
        where: { id: instance.id },
        data: {
          currentStep: currentStep.sequence + 1,
        },
      });
    }

    return instance;
  }

  async reject(instanceId: string, userId: string, comments?: string, tenantId?: string) {
    const instance = await this.getInstanceWithTemplate(instanceId, tenantId);

    if (instance.status !== WorkflowStatus.IN_PROGRESS) {
      throw new BadRequestException('Workflow is not in progress');
    }

    const currentStep = instance.template.steps.find(
      (step) => step.sequence === instance.currentStep,
    );

    if (!currentStep) {
      throw new NotFoundException('Workflow step not found');
    }

    if (!currentStep.canReject) {
      throw new BadRequestException('Current workflow step does not allow rejection');
    }

    await this.assertApprover(
      instance.tenantId,
      currentStep.approverType,
      currentStep.approverRole,
      currentStep.approverUserId,
      userId,
    );

    await this.prisma.workflowAction.create({
      data: {
        instanceId: instance.id,
        stepNumber: currentStep.sequence,
        action: WorkflowActionType.REJECT,
        performedBy: userId,
        comments,
      },
    });

    return this.prisma.workflowInstance.update({
      where: { id: instance.id },
      data: {
        status: WorkflowStatus.REJECTED,
        completedAt: new Date(),
      },
    });
  }

  async ensureApproved(tenantId: string, entityType: WorkflowEntityType, entityId: string) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { tenantId, entityType, entityId },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance || instance.status !== WorkflowStatus.APPROVED) {
      throw new BadRequestException(`Workflow for ${entityType} is not approved`);
    }

    return instance;
  }

  private async getInstanceWithTemplate(instanceId: string, tenantId?: string) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, ...(tenantId ? { tenantId } : {}) },
      include: {
        template: {
          include: {
            steps: { orderBy: { sequence: 'asc' } },
          },
        },
      },
    });

    if (!instance) {
      throw new NotFoundException('Workflow instance not found');
    }

    return instance;
  }

  private async assertApprover(
    tenantId: string,
    approverType: ApproverType,
    approverRole: string | null,
    approverUserId: string | null,
    userId: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (approverType === ApproverType.USER && approverUserId !== userId) {
      throw new BadRequestException('User is not an authorized approver');
    }

    if (approverType === ApproverType.ROLE && approverRole && approverRole !== user.role) {
      throw new BadRequestException('User does not have approver role');
    }

    if (approverType === ApproverType.MANAGER && user.role !== 'ADMIN') {
      throw new BadRequestException('Manager approvals require ADMIN');
    }

    if (approverType === ApproverType.DYNAMIC && user.role === 'VIEWER') {
      throw new BadRequestException('User does not meet dynamic approver requirements');
    }
  }

  private assertTemplateStepsIntegrity(steps: Array<{ sequence: number }>) {
    if (!steps.length) {
      throw new BadRequestException('Workflow template must contain at least one step');
    }

    const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
    for (let index = 0; index < sorted.length; index += 1) {
      const expectedSequence = index + 1;
      if (sorted[index].sequence !== expectedSequence) {
        throw new BadRequestException('Workflow steps must use contiguous sequence numbers starting at 1');
      }
    }
  }
}
