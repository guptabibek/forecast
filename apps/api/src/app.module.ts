import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { validateEnv } from './core/config/env.validation';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';
import { TenantGuard } from './core/guards/tenant.guard';
import { ModuleGuard } from './modules/platform/module.guard';

// Core modules
import { AuditModule } from './core/audit/audit.module';
import { CacheModule } from './core/cache/cache.module';
import { DatabaseModule } from './core/database/database.module';
import { FxRateModule } from './core/finance/fx-rate.module';
import { NotificationModule } from './core/notification/notification.module';
import { QueueModule } from './core/queue/queue.module';
import { TimeBucketModule } from './core/time/time-bucket.module';
import { WorkflowModule } from './core/workflow/workflow.module';

// Feature modules
import { AuditFeatureModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DataModule } from './modules/data/data.module';
import { ForecastsModule } from './modules/forecasts/forecasts.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { MargEdeModule } from './modules/marg-ede/marg-ede.module';
import { NotificationFeatureModule } from './modules/notifications/notification.module';
import { PlansModule } from './modules/plans/plans.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { ScenariosModule } from './modules/scenarios/scenarios.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

// Forecast Engine
import { ForecastEngineModule } from './forecast-engine/forecast-engine.module';

// Middleware
import { LoggerMiddleware } from './core/middleware/logger.middleware';
import { TenantMiddleware } from './core/middleware/tenant.middleware';

// Controllers
import { AppController } from './app.controller';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 50,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 200,
      },
    ]),

    // Continuation-Local Storage for tenant context
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
      },
    }),

    // Scheduler (cron jobs)
    ScheduleModule.forRoot(),

    // Core modules
    CacheModule,
    DatabaseModule,
    QueueModule.register(),
    WorkflowModule,
    TimeBucketModule,
    FxRateModule,
    AuditModule,
    NotificationModule,

    // Forecast Engine
    ForecastEngineModule,

    // Feature modules
    AuthModule,
    UsersModule,
    PlansModule,
    ForecastsModule,
    ScenariosModule,
    DataModule,
    SettingsModule,
    ReportsModule,
    ManufacturingModule,
    AuditFeatureModule,
    NotificationFeatureModule,
    MargEdeModule,
    PlatformModule,
    RolesModule,
  ],
  controllers: [AppController],
  providers: [
    // Global exception filter – sanitises Prisma / unhandled errors
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Global rate-limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global tenant scope guard – rejects requests without resolved tenant
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    // Global module feature guard – enforces @RequireModule() on controllers
    {
      provide: APP_GUARD,
      useClass: ModuleGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .exclude('health', '/')
      .forRoutes('*');

    consumer
      .apply(TenantMiddleware)
      .exclude('api/v1/auth/login', 'api/v1/auth/register', 'health', '/')
      .forRoutes('*');
  }
}
