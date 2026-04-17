import { SetMetadata } from '@nestjs/common';
import { PlatformModuleKey, REQUIRE_MODULE_KEY } from './platform.constants';

/**
 * Decorator that marks a controller or handler as requiring a specific module
 * to be enabled for the tenant. Enforced by ModuleGuard.
 *
 * @example
 * @RequireModule('manufacturing')
 * @Controller('manufacturing')
 * export class ManufacturingController { ... }
 */
export const RequireModule = (module: PlatformModuleKey) =>
  SetMetadata(REQUIRE_MODULE_KEY, module);
