import { Module } from '@nestjs/common';
import { ForecastEngineModule } from '../../forecast-engine/forecast-engine.module';
import { RolesModule } from '../roles/roles.module';
import { ModuleGuard } from './module.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [RolesModule, ForecastEngineModule],
  controllers: [PlatformController],
  providers: [PlatformService, ModuleGuard],
  exports: [PlatformService, ModuleGuard],
})
export class PlatformModule {}
