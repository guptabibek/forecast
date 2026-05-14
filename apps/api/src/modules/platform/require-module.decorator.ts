import { SetMetadata } from '@nestjs/common';
import { PlatformModuleKey, REQUIRE_MODULE_KEY } from './platform.constants';

/**
 * Decorator that marks a controller or handler as requiring a specific module
 * (or any of several modules) to be enabled for the tenant. Enforced by ModuleGuard.
 *
 * Pass an array to express any-of semantics — the request is allowed when *any*
 * of the listed modules is enabled. Use this for endpoints that have been
 * surfaced under multiple sidebar groups (e.g., purchase orders living under
 * both Manufacturing and Planning).
 *
 * Handler-level metadata overrides class-level metadata via `getAllAndOverride`,
 * so individual endpoints can relax / replace their controller's requirement.
 *
 * @example
 * @RequireModule('manufacturing')
 * @Controller('manufacturing')
 * export class ManufacturingController { ... }
 *
 * @example
 * // Endpoint is reachable when EITHER manufacturing OR planning is enabled
 * @RequireModule(['manufacturing', 'planning'])
 * @Get('purchase-orders')
 * async getPurchaseOrders(...) { ... }
 */
export const RequireModule = (module: PlatformModuleKey | PlatformModuleKey[]) =>
  SetMetadata(REQUIRE_MODULE_KEY, module);
