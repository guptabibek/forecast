import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

const IMPLIED_ROLES: Record<string, string[]> = {
  FORECAST_PLANNER: ['FORECAST_PLANNER', 'PLANNER', 'VIEWER'],
  FORECAST_VIEWER: ['FORECAST_VIEWER', 'VIEWER'],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check for required roles
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Check for required permissions
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles or permissions required, allow access
    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Check roles
    if (requiredRoles?.length) {
      const effectiveRoles = IMPLIED_ROLES[user.role] || [user.role];
      const hasRole = requiredRoles.some((role) => effectiveRoles.includes(role));
      if (!hasRole) {
        throw new ForbiddenException(
          `Required role: ${requiredRoles.join(' or ')}`,
        );
      }
    }

    // Check permissions
    if (requiredPermissions?.length) {
      const userPermissions = user.permissions || [];
      const hasAllPermissions = requiredPermissions.every((permission) =>
        userPermissions.includes(permission),
      );

      if (!hasAllPermissions) {
        throw new ForbiddenException(
          `Required permissions: ${requiredPermissions.join(', ')}`,
        );
      }
    }

    return true;
  }
}
