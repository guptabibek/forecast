import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, TenantId } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { PERMISSION_DEFINITIONS } from './rbac.constants';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /** List all roles for the current tenant */
  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'List tenant roles' })
  async listRoles(@TenantId() tenantId: string) {
    return { data: await this.rolesService.listRoles(tenantId) };
  }

  /** Get permission definitions (for the permission picker UI) */
  @Get('permissions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all permission definitions' })
  getPermissionDefinitions() {
    return { data: PERMISSION_DEFINITIONS };
  }

  /** Get a single role by ID */
  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get role details' })
  async getRole(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.rolesService.getRole(tenantId, id) };
  }

  /** Create a new custom role */
  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a custom role' })
  async createRole(
    @TenantId() tenantId: string,
    @Body() dto: CreateRoleDto,
  ) {
    return { data: await this.rolesService.createRole(tenantId, dto) };
  }

  /** Update a role */
  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update a role' })
  async updateRole(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return { data: await this.rolesService.updateRole(tenantId, id, dto) };
  }

  /** Delete a custom role */
  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete a custom role' })
  async deleteRole(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return await this.rolesService.deleteRole(tenantId, id);
  }

  /** Get the current user's effective role + permissions */
  @Get('me/effective')
  @ApiOperation({ summary: 'Get current user effective role' })
  async getMyRole(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return { data: await this.rolesService.resolveUserRole(userId, tenantId) };
  }
}
