import { Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module';
import { ModuleGuard } from './module.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [RolesModule],
  controllers: [PlatformController],
  providers: [PlatformService, ModuleGuard],
  exports: [PlatformService, ModuleGuard],
})
export class PlatformModule {}
