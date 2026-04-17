import { Controller, Get, HttpCode, HttpStatus, Res, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { TenantCacheService } from './core/cache/tenant-cache.service';
import { PrismaService } from './core/database/prisma.service';
import { SKIP_TENANT_CHECK } from './core/guards/tenant.guard';
import { isRedisConfigured } from './core/queue/queue.module';

@ApiTags('Health')
@Controller()
@SetMetadata(SKIP_TENANT_CHECK, true)
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: TenantCacheService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async healthCheck() {
    const dbHealthy = await this.checkDatabase();
    return {
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        api: 'healthy',
        database: dbHealthy ? 'healthy' : 'unhealthy',
      },
    };
  }

  @Get('health/live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe endpoint' })
  @ApiResponse({ status: 200, description: 'Service process is alive' })
  live() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe endpoint' })
  @ApiResponse({ status: 200, description: 'All critical dependencies are ready' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are unavailable' })
  async readiness(@Res({ passthrough: true }) res: Response) {
    const dbHealthy = await this.checkDatabase();
    const redisConfigured = isRedisConfigured();
    const redisHealthy = redisConfigured ? await this.cacheService.isHealthy() : true;
    const ready = dbHealthy && redisHealthy;
    const statusCode = ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(statusCode);
    
    return {
      statusCode,
      status: ready ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        api: ready ? 'ready' : 'degraded',
        database: dbHealthy ? 'healthy' : 'unhealthy',
        redis: redisConfigured
          ? (redisHealthy ? 'healthy' : 'unhealthy')
          : 'disabled',
      },
    };
  }

  @Get()
  @ApiOperation({ summary: 'API root' })
  @ApiResponse({ status: 200, description: 'API information' })
  getRoot() {
    return {
      name: 'Forecast SaaS API',
      version: process.env.npm_package_version || '1.0.0',
      documentation: '/api/docs',
      health: '/health',
      liveness: '/health/live',
      readiness: '/health/ready',
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
