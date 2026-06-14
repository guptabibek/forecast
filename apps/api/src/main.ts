import { Logger, LogLevel, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Install a global JSON serializer for BigInt so Express response.json() does
// not throw "Do not know how to serialize a BigInt" when controllers return
// Prisma rows that include BigInt columns (e.g. MargSyncLog.rowsProcessed,
// MargTransaction.margId, MargAccountPosting.margId). Emit as a string —
// numbers >2^53 lose precision when coerced to JS Number, and strings round-
// trip safely through every common JSON consumer.
if (typeof (BigInt.prototype as { toJSON?: () => string }).toJSON !== 'function') {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint) { return this.toString(); },
    writable: true,
    configurable: true,
  });
}

// Parse LOG_LEVEL env into Nest log levels.
//   LOG_LEVEL=error            -> errors only (quiet prod)
//   LOG_LEVEL=error,warn       -> errors + warnings (recommended default)
//   LOG_LEVEL=error,warn,log   -> + info (verbose)
//   LOG_LEVEL=debug            -> + debug + verbose (developer)
// Sync-flow logs use SyncLogger (./modules/marg-ede/sync-logger.ts) which
// writes directly to stdout and is NOT subject to this filter — operators
// always see what the Marg sync is doing even when the rest of the API is
// silenced. Unrecognised tokens are ignored.
function parseLogLevels(raw: string | undefined): LogLevel[] {
  const valid: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  if (!raw) return ['error', 'warn'];
  const tokens = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tokens.includes('debug')) return valid;
  const picked = tokens.filter((t): t is LogLevel => (valid as string[]).includes(t));
  return picked.length > 0 ? picked : ['error', 'warn'];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: parseLogLevels(process.env.LOG_LEVEL),
  });

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';
  const isProd = nodeEnv === 'production';

  // Reverse proxies forward the real client IP. Trust the configured number of
  // hops so rate limiting does not collapse all users into the proxy IP.
  const trustProxyHops = Number(configService.get<string>('TRUST_PROXY_HOPS') || 1);
  app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : 1);

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProd
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    }),
  );
  app.use(compression());

  // Body size limits — prevent large payload DoS.
  // The Stripe webhook needs the RAW body for HMAC signature verification —
  // capture it for that route only.
  app.use(json({
    limit: '10mb',
    verify: (req: any, _res: unknown, buf: Buffer) => {
      if (req.originalUrl?.includes('/ai-billing/webhooks/stripe')) {
        req.rawBody = Buffer.from(buf);
      }
    },
  }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.enableCors({
    // Reflect the caller origin so SaaS workspace URLs do not require env allowlist churn.
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Request-ID'],
  });

  // API versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'api/v',
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger documentation
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ForecastHub API')
      .setDescription('Multi-Tenant Planning & Forecasting SaaS API')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Tenant-ID', in: 'header' }, 'tenant-id')
      .addTag('Auth', 'Authentication & Authorization')
      .addTag('Users', 'User Management')
      .addTag('Actuals', 'Historical Data Ingestion')
      .addTag('Plans', 'Plan Version Management')
      .addTag('Forecasts', 'Forecast Generation & Management')
      .addTag('Scenarios', 'Scenario Planning')
      .addTag('Dimensions', 'Master Data Management')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('API_PORT') || configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`ForecastHub API running on: http://localhost:${port}`);
  logger.log(`API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
