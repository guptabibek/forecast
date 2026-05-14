import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { AuditAction, PeriodType, PlanStatus, PlanType, Prisma, WorkflowEntityType, WorkflowStatus } from '@prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { WorkflowService } from '../../core/workflow/workflow.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PlanQueryDto } from './dto/plan-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Calculate fiscal year from start date
   */
  private calculateFiscalYear(startDate: Date): number {
    return startDate.getFullYear();
  }

  /**
   * Transform plan version to include fiscalYear and ensure consistent response shape
   */
  private transformPlanResponse(plan: any): any {
    if (!plan) return null;
    
    return {
      ...plan,
      fiscalYear: this.calculateFiscalYear(new Date(plan.startDate)),
    };
  }

  async create(createPlanDto: CreatePlanDto, user: any) {
    this.logger.log(`Creating plan: ${createPlanDto.name} for tenant: ${user.tenantId}`);
    
    // Use transaction to ensure atomic creation
    const planVersion = await this.prisma.$transaction(async (tx) => {
      // Check for existing plan with same name+version to provide a clear error
      const existing = await tx.planVersion.findFirst({
        where: { tenantId: user.tenantId, name: createPlanDto.name, version: 1 },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `A plan named "${createPlanDto.name}" already exists. Use a different name or update the existing plan.`,
        );
      }
      const startDate = new Date(createPlanDto.startDate);
      const fiscalYear = createPlanDto.fiscalYear || this.calculateFiscalYear(startDate);
      
      const plan = await tx.planVersion.create({
        data: {
          name: createPlanDto.name,
          description: createPlanDto.description,
          tenant: { connect: { id: user.tenantId } },
          createdBy: { connect: { id: user.id } },
          planType: (createPlanDto.planType as PlanType) || PlanType.FORECAST,
          status: PlanStatus.DRAFT,
          version: 1,
          startDate: startDate,
          endDate: new Date(createPlanDto.endDate),
          periodType: (createPlanDto.periodType as PeriodType) || PeriodType.MONTHLY,
          settings: {
            ...(createPlanDto.settings || {}),
            fiscalYear,
          },
        },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      // Create default baseline scenario for new plans
      await tx.scenario.create({
        data: {
          name: 'Base Scenario',
          description: 'Default baseline scenario',
          tenant: { connect: { id: user.tenantId } },
          planVersion: { connect: { id: plan.id } },
          scenarioType: 'BASE',
          isBaseline: true,
          color: '#3b82f6',
          sortOrder: 0,
        },
      });

      return plan;
    });

    this.logger.log(`Plan created successfully: ${planVersion.id}`);
    
    // Return full plan data including the newly created scenario
    return this.findOne(planVersion.id, user);
  }

  async findAll(query: PlanQueryDto, user: any) {
    const { page = 1, pageSize = 20, status, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.PlanVersionWhereInput = {
      tenantId: user.tenantId,
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [planVersions, total] = await Promise.all([
      this.prisma.planVersion.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: sortBy ? { [sortBy]: sortOrder || 'desc' } : { updatedAt: 'desc' },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          scenarios: {
            select: { id: true, name: true, scenarioType: true, isBaseline: true },
            orderBy: { sortOrder: 'asc' },
          },
          _count: {
            select: { forecasts: true, scenarios: true },
          },
        },
      }),
      this.prisma.planVersion.count({ where }),
    ]);

    // Transform to include fiscalYear
    const transformedPlans = planVersions.map((plan) => this.transformPlanResponse(plan));

    return {
      data: transformedPlans,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string, user: any) {
    this.logger.debug(`Fetching plan ${id} for tenant ${user.tenantId}`);
    
    const planVersion = await this.prisma.planVersion.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
      },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        approvedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        // Include ALL scenarios for this plan
        scenarios: {
          orderBy: { sortOrder: 'asc' },
          include: {
            _count: {
              select: { forecasts: true, assumptions: true },
            },
          },
        },
        // Include ALL forecasts for this plan
        forecasts: {
          orderBy: { periodDate: 'asc' },
          include: {
            product: { select: { id: true, name: true, code: true } },
            location: { select: { id: true, name: true, code: true } },
            scenario: { select: { id: true, name: true, scenarioType: true } },
          },
        },
        // Include ALL assumptions for this plan
        assumptions: {
          orderBy: { createdAt: 'desc' },
          include: {
            scenario: { select: { id: true, name: true } },
          },
        },
        // Include count summary
        _count: {
          select: {
            forecasts: true,
            scenarios: true,
            assumptions: true,
          },
        },
      },
    });

    if (!planVersion) {
      this.logger.warn(`Plan ${id} not found for tenant ${user.tenantId}`);
      throw new NotFoundException('Plan not found');
    }

    this.logger.debug(`Plan ${id} found with ${planVersion.scenarios.length} scenarios, ${planVersion.forecasts.length} forecasts`);
    
    // Log scenario details for debugging
    if (planVersion.scenarios.length > 0) {
      this.logger.debug(`Scenarios: ${planVersion.scenarios.map(s => `${s.name}(${s.id})`).join(', ')}`);
    } else {
      this.logger.warn(`Plan ${id} has NO scenarios - this may indicate a problem`);
    }

    return this.transformPlanResponse(planVersion);
  }

  async update(id: string, updatePlanDto: UpdatePlanDto, user: any) {
    this.logger.log(`Updating plan ${id}`);
    
    const planVersion = await this.findOne(id, user);

    if (planVersion.status === PlanStatus.APPROVED || planVersion.status === PlanStatus.LOCKED) {
      throw new BadRequestException('Cannot modify an approved or locked plan');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update the plan
      const plan = await tx.planVersion.update({
        where: { id },
        data: {
          ...(updatePlanDto.name && { name: updatePlanDto.name }),
          ...(updatePlanDto.description !== undefined && { description: updatePlanDto.description }),
          ...(updatePlanDto.startDate && { startDate: new Date(updatePlanDto.startDate) }),
          ...(updatePlanDto.endDate && { endDate: new Date(updatePlanDto.endDate) }),
          ...(updatePlanDto.settings && { 
            settings: {
              ...(planVersion.settings as object || {}),
              ...updatePlanDto.settings,
            },
          }),
          updatedAt: new Date(),
        },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          scenarios: {
            orderBy: { sortOrder: 'asc' },
            include: {
              _count: {
                select: { forecasts: true, assumptions: true },
              },
            },
          },
          forecasts: {
            orderBy: { periodDate: 'asc' },
            include: {
              product: { select: { id: true, name: true, code: true } },
              location: { select: { id: true, name: true, code: true } },
              scenario: { select: { id: true, name: true, scenarioType: true } },
            },
          },
          _count: {
            select: {
              forecasts: true,
              scenarios: true,
              assumptions: true,
            },
          },
        },
      });

      return plan;
    });

    this.logger.log(`Plan ${id} updated successfully`);
    return this.transformPlanResponse(updated);
  }

  async remove(id: string, user: any) {
    const planVersion = await this.findOne(id, user);

    if (planVersion.status === PlanStatus.APPROVED || planVersion.status === PlanStatus.LOCKED) {
      throw new BadRequestException('Cannot delete an approved or locked plan');
    }

    await this.prisma.planVersion.delete({ where: { id, tenantId: user.tenantId } });
  }

  async clone(id: string, name: string, user: any) {
    const original = await this.findOne(id, user);

    const cloned = await this.prisma.planVersion.create({
      data: {
        name: name || `${original.name} (Copy)`,
        description: original.description,
        tenant: { connect: { id: user.tenantId } },
        startDate: original.startDate,
        endDate: original.endDate,
        periodType: original.periodType,
        planType: original.planType,
        settings: original.settings as Prisma.JsonObject,
        status: PlanStatus.DRAFT,
        version: 1,
        createdBy: { connect: { id: user.id } },
        parentVersion: { connect: { id: original.id } },
      },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    // Clone scenarios
    const scenarios = await this.prisma.scenario.findMany({
      where: { planVersionId: original.id },
    });

    for (const scenario of scenarios) {
      await this.prisma.scenario.create({
        data: {
          name: scenario.name,
          description: scenario.description,
          tenant: { connect: { id: user.tenantId } },
          planVersion: { connect: { id: cloned.id } },
          scenarioType: scenario.scenarioType,
          isBaseline: scenario.isBaseline,
          color: scenario.color,
          sortOrder: scenario.sortOrder,
        },
      });
    }

    // Return the cloned plan with full data
    return this.findOne(cloned.id, user);
  }

  async submit(id: string, user: any) {
    const planVersion = await this.findOne(id, user);

    if (planVersion.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only draft plans can be submitted');
    }

    // Validate plan has required data (scenarios or forecasts)
    const scenarioCount = await this.prisma.scenario.count({
      where: { planVersionId: id },
    });

    if (scenarioCount === 0) {
      throw new BadRequestException('Plan must have at least one scenario');
    }

    await this.workflowService.startWorkflow(
      user.tenantId,
      WorkflowEntityType.PLAN_VERSION,
      id,
      user.id,
      'Plan submitted for approval',
    );

    await this.prisma.planVersion.update({
      where: { id },
      data: {
        status: PlanStatus.IN_REVIEW,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'PlanVersion',
      id,
      { status: PlanStatus.DRAFT },
      { status: PlanStatus.IN_REVIEW },
      ['status'],
    );

    // Return full plan data
    return this.findOne(id, user);
  }

  async approve(id: string, user: any) {
    const planVersion = await this.findOne(id, user);

    if (planVersion.status !== PlanStatus.IN_REVIEW) {
      throw new BadRequestException('Only plans in review can be approved');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.PLAN_VERSION,
        entityId: id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for plan');
    }

    const workflow = await this.workflowService.approve(instance.id, user.id, 'Plan approved');

    if (workflow.status !== WorkflowStatus.APPROVED) {
      return this.findOne(id, user);
    }

    await this.prisma.planVersion.update({
      where: { id },
      data: {
        status: PlanStatus.APPROVED,
        approvedAt: new Date(),
        approvedBy: { connect: { id: user.id } },
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.APPROVE,
      'PlanVersion',
      id,
      { status: PlanStatus.IN_REVIEW },
      { status: PlanStatus.APPROVED },
      ['status'],
    );

    // Return full plan data
    return this.findOne(id, user);
  }

  async reject(id: string, reason: string, user: any) {
    const planVersion = await this.findOne(id, user);

    if (planVersion.status !== PlanStatus.IN_REVIEW) {
      throw new BadRequestException('Only plans in review can be rejected');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.PLAN_VERSION,
        entityId: id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for plan');
    }

    await this.workflowService.reject(instance.id, user.id, reason);

    await this.prisma.planVersion.update({
      where: { id },
      data: {
        status: PlanStatus.DRAFT,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'PlanVersion',
      id,
      { status: PlanStatus.IN_REVIEW },
      { status: PlanStatus.DRAFT },
      ['status'],
    );

    // Return full plan data
    return this.findOne(id, user);
  }

  async lock(id: string, reason: string, user: any) {
    const planVersion = await this.findOne(id, user);

    if (planVersion.isLocked) {
      throw new BadRequestException('Plan is already locked');
    }

    if (planVersion.status !== PlanStatus.APPROVED) {
      throw new BadRequestException('Only approved plans can be locked');
    }

    await this.workflowService.ensureApproved(
      user.tenantId,
      WorkflowEntityType.PLAN_VERSION,
      id,
    );

    await this.prisma.planVersion.update({
      where: { id },
      data: {
        isLocked: true,
        lockedAt: new Date(),
        lockedReason: reason,
        status: PlanStatus.LOCKED,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.LOCK,
      'PlanVersion',
      id,
      { status: PlanStatus.APPROVED },
      { status: PlanStatus.LOCKED },
      ['status'],
    );

    // Return full plan data
    return this.findOne(id, user);
  }

  async unlock(id: string, user: any) {
    const planVersion = await this.findOne(id, user);

    if (!planVersion.isLocked) {
      throw new BadRequestException('Plan is not locked');
    }

    await this.prisma.planVersion.update({
      where: { id },
      data: {
        isLocked: false,
        lockedAt: null,
        lockedReason: null,
        status: PlanStatus.DRAFT,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UNLOCK,
      'PlanVersion',
      id,
      { status: PlanStatus.LOCKED },
      { status: PlanStatus.DRAFT },
      ['status'],
    );

    // Return full plan data
    return this.findOne(id, user);
  }

  async archive(id: string, user: any) {
    await this.findOne(id, user);

    await this.prisma.planVersion.update({
      where: { id },
      data: {
        status: PlanStatus.ARCHIVED,
      },
    });

    // Return full plan data
    return this.findOne(id, user);
  }

  async getVersionHistory(id: string, user: any) {
    const planVersion = await this.findOne(id, user);

    // Get all versions in the lineage
    const versions = await this.prisma.planVersion.findMany({
      where: {
        OR: [
          { id: planVersion.id },
          { parentVersionId: planVersion.id },
          { id: planVersion.parentVersionId || undefined },
        ],
        tenantId: user.tenantId,
      },
      orderBy: { version: 'desc' },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        scenarios: {
          select: { id: true, name: true, scenarioType: true },
        },
        _count: {
          select: { forecasts: true, scenarios: true },
        },
      },
    });

    // Transform to include fiscalYear
    return versions.map((v) => this.transformPlanResponse(v));
  }
}
