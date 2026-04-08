import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { AuditAction, PlanStatus, ScenarioType, WorkflowEntityType, WorkflowStatus } from '@prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { WorkflowService } from '../../core/workflow/workflow.service';
import { CreateScenarioDto } from './dto/create-scenario.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';

@Injectable()
export class ScenariosService {
  private readonly logger = new Logger(ScenariosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
    private readonly auditService: AuditService,
  ) {}

  async create(createDto: CreateScenarioDto, user: any) {
    // Validate plan version exists
    const planVersion = await this.prisma.planVersion.findFirst({
      where: { id: createDto.planVersionId, tenantId: user.tenantId },
    });

    if (!planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    // Check for duplicate name in same plan version
    const existingScenario = await this.prisma.scenario.findFirst({
      where: {
        tenantId: user.tenantId,
        planVersionId: createDto.planVersionId,
        name: createDto.name,
      },
    });

    if (existingScenario) {
      throw new BadRequestException('Scenario with this name already exists for this plan version');
    }

    const scenarioType = (createDto.scenarioType || 'BASE') as ScenarioType;

    return this.prisma.scenario.create({
      data: {
        name: createDto.name,
        description: createDto.description,
        planVersion: { connect: { id: createDto.planVersionId } },
        scenarioType: scenarioType,
        tenant: { connect: { id: user.tenantId } },
        isBaseline: scenarioType === 'BASE',
        color: createDto.color,
        sortOrder: createDto.sortOrder || 0,
      },
      include: {
        planVersion: { select: { id: true, name: true, version: true } },
      },
    });
  }

  async findAll(planVersionId: string | undefined, user: any) {
    this.logger.debug(`Fetching scenarios for tenant ${user.tenantId}, planVersionId: ${planVersionId || 'ALL'}`);

    const scenarios = await this.prisma.scenario.findMany({
      where: {
        tenantId: user.tenantId,
        ...(planVersionId && { planVersionId }),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        planVersion: { 
          select: { 
            id: true, 
            name: true,
            version: true,
          } 
        },
        _count: {
          select: { forecasts: true, assumptions: true },
        },
      },
    });

    this.logger.debug(`Found ${scenarios.length} scenarios for planVersionId: ${planVersionId || 'ALL'}`);
    return scenarios;
  }

  async findOne(id: string, user: any) {
    const scenario = await this.prisma.scenario.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        planVersion: {
          select: {
            id: true,
            name: true,
            version: true,
          },
        },
        forecasts: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            product: { select: { id: true, name: true, code: true } },
            location: { select: { id: true, name: true, code: true } },
          },
        },
        assumptions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    return scenario;
  }

  async update(id: string, updateDto: UpdateScenarioDto, user: any) {
    const scenario = await this.findOne(id, user);

    if (scenario.status === PlanStatus.LOCKED) {
      throw new BadRequestException('Scenario is locked');
    }

    return this.prisma.scenario.update({
      where: { id },
      data: {
        ...(updateDto.name && { name: updateDto.name }),
        ...(updateDto.description !== undefined && { description: updateDto.description }),
        ...(updateDto.scenarioType && { scenarioType: updateDto.scenarioType as ScenarioType }),
        ...(updateDto.color !== undefined && { color: updateDto.color }),
        ...(updateDto.sortOrder !== undefined && { sortOrder: updateDto.sortOrder }),
      },
      include: {
        planVersion: { select: { id: true, name: true, version: true } },
      },
    });
  }

  async remove(id: string, user: any) {
    const scenario = await this.findOne(id, user);
    
    if (scenario.isBaseline) {
      throw new BadRequestException('Cannot delete baseline scenario');
    }

    if (scenario.status === PlanStatus.LOCKED) {
      throw new BadRequestException('Cannot delete locked scenario');
    }

    await this.prisma.scenario.delete({ where: { id } });
    return { success: true };
  }

  async submit(id: string, user: any) {
    const scenario = await this.findOne(id, user);

    if (scenario.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only draft scenarios can be submitted');
    }

    await this.workflowService.startWorkflow(
      user.tenantId,
      WorkflowEntityType.SCENARIO,
      id,
      user.id,
      'Scenario submitted for approval',
    );

    await this.prisma.scenario.update({
      where: { id },
      data: { status: PlanStatus.IN_REVIEW },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'Scenario',
      id,
      { status: PlanStatus.DRAFT },
      { status: PlanStatus.IN_REVIEW },
      ['status'],
    );

    return this.findOne(id, user);
  }

  async approve(id: string, user: any) {
    const scenario = await this.findOne(id, user);

    if (scenario.status !== PlanStatus.IN_REVIEW) {
      throw new BadRequestException('Only scenarios in review can be approved');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.SCENARIO,
        entityId: id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for scenario');
    }

    const workflow = await this.workflowService.approve(instance.id, user.id, 'Scenario approved');

    if (workflow.status !== WorkflowStatus.APPROVED) {
      return this.findOne(id, user);
    }

    await this.prisma.scenario.update({
      where: { id },
      data: { status: PlanStatus.APPROVED },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.APPROVE,
      'Scenario',
      id,
      { status: PlanStatus.IN_REVIEW },
      { status: PlanStatus.APPROVED },
      ['status'],
    );

    return this.findOne(id, user);
  }

  async reject(id: string, reason: string, user: any) {
    const scenario = await this.findOne(id, user);

    if (scenario.status !== PlanStatus.IN_REVIEW) {
      throw new BadRequestException('Only scenarios in review can be rejected');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.SCENARIO,
        entityId: id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for scenario');
    }

    await this.workflowService.reject(instance.id, user.id, reason);

    await this.prisma.scenario.update({
      where: { id },
      data: { status: PlanStatus.DRAFT },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'Scenario',
      id,
      { status: PlanStatus.IN_REVIEW },
      { status: PlanStatus.DRAFT },
      ['status'],
    );

    return this.findOne(id, user);
  }

  async lock(id: string, reason: string, user: any) {
    const scenario = await this.findOne(id, user);

    if (scenario.status !== PlanStatus.APPROVED) {
      throw new BadRequestException('Only approved scenarios can be locked');
    }

    await this.workflowService.ensureApproved(
      user.tenantId,
      WorkflowEntityType.SCENARIO,
      id,
    );

    await this.prisma.scenario.update({
      where: { id },
      data: {
        status: PlanStatus.LOCKED,
        lockedAt: new Date(),
        lockedReason: reason,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.LOCK,
      'Scenario',
      id,
      { status: PlanStatus.APPROVED },
      { status: PlanStatus.LOCKED },
      ['status'],
    );

    return this.findOne(id, user);
  }

  async clone(id: string, newName: string, user: any) {
    const scenario = await this.findOne(id, user);

    // Clone the scenario
    const clonedScenario = await this.prisma.scenario.create({
      data: {
        name: newName,
        description: `Cloned from ${scenario.name}`,
        planVersion: { connect: { id: scenario.planVersion.id } },
        scenarioType: 'CUSTOM',
        tenant: { connect: { id: user.tenantId } },
        isBaseline: false,
        color: scenario.color,
        sortOrder: scenario.sortOrder + 1,
      },
      include: {
        planVersion: { select: { id: true, name: true, version: true } },
      },
    });

    // Clone associated assumptions
    const assumptions = await this.prisma.assumption.findMany({
      where: { scenarioId: id },
    });

    for (const assumption of assumptions) {
      await this.prisma.assumption.create({
        data: {
          tenant: { connect: { id: user.tenantId } },
          planVersion: { connect: { id: assumption.planVersionId } },
          scenario: { connect: { id: clonedScenario.id } },
          name: assumption.name,
          description: assumption.description,
          assumptionType: assumption.assumptionType,
          ...(assumption.productId && { product: { connect: { id: assumption.productId } } }),
          ...(assumption.locationId && { location: { connect: { id: assumption.locationId } } }),
          ...(assumption.customerId && { customer: { connect: { id: assumption.customerId } } }),
          ...(assumption.accountId && { account: { connect: { id: assumption.accountId } } }),
          value: assumption.value,
          valueType: assumption.valueType,
          startDate: assumption.startDate,
          endDate: assumption.endDate,
          priority: assumption.priority,
          isActive: assumption.isActive,
        },
      });
    }

    return clonedScenario;
  }

  async compare(scenarioIds: string[], user: any) {
    // Validate all scenarios exist
    const scenarios = await this.prisma.scenario.findMany({
      where: {
        id: { in: scenarioIds },
        tenantId: user.tenantId,
      },
      include: {
        forecasts: true,
        assumptions: true,
      },
    });

    if (scenarios.length !== scenarioIds.length) {
      throw new NotFoundException('One or more scenarios not found');
    }

    // Find baseline scenario for comparison
    const baseline = scenarios.find((s) => s.isBaseline) || scenarios[0];

    // Calculate comparison metrics for each scenario
    const comparisonResults = scenarios.map((scenario) => {
      const totalForecastAmount = scenario.forecasts.reduce(
        (sum, f) => sum + Number(f.forecastAmount),
        0,
      );

      const baselineTotalAmount = baseline.forecasts.reduce(
        (sum, f) => sum + Number(f.forecastAmount),
        0,
      );

      const variance = totalForecastAmount - baselineTotalAmount;
      const variancePercent = baselineTotalAmount !== 0 
        ? (variance / baselineTotalAmount) * 100 
        : 0;

      return {
        id: scenario.id,
        name: scenario.name,
        scenarioType: scenario.scenarioType,
        isBaseline: scenario.isBaseline,
        totalForecastAmount,
        variance: scenario.id === baseline.id ? 0 : variance,
        variancePercent: scenario.id === baseline.id ? 0 : variancePercent,
        assumptionCount: scenario.assumptions.length,
        forecastCount: scenario.forecasts.length,
      };
    });

    return {
      baselineId: baseline.id,
      baselineName: baseline.name,
      scenarios: comparisonResults,
    };
  }

  async setBaseline(id: string, user: any) {
    const scenario = await this.findOne(id, user);

    // Remove baseline flag from any existing baseline in same plan version
    await this.prisma.scenario.updateMany({
      where: {
        tenantId: user.tenantId,
        planVersionId: scenario.planVersion.id,
        isBaseline: true,
      },
      data: { isBaseline: false },
    });

    // Set this scenario as baseline
    return this.prisma.scenario.update({
      where: { id },
      data: {
        isBaseline: true,
        scenarioType: 'BASE',
      },
      include: {
        planVersion: { select: { id: true, name: true, version: true } },
      },
    });
  }
}
