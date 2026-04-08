import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly cls: ClsService) {}

  private serialize(data: Record<string, unknown>): string {
    return JSON.stringify(data);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const incomingRequestId = req.header('x-request-id')?.trim();
    const requestId = incomingRequestId || uuidv4();

    // Store request ID in CLS (only if context is active)
    if (this.cls.isActive()) {
      this.cls.set('requestId', requestId);
      this.cls.set('ipAddress', req.ip || req.socket.remoteAddress || 'unknown');
      this.cls.set('userAgent', req.headers['user-agent'] || 'unknown');
    }

    // Store requestId on request object as fallback
    (req as any).requestId = requestId;

    // Add request ID to response headers
    res.setHeader('X-Request-ID', requestId);

    // Log request
    this.logger.log(
      this.serialize({
        event: 'http_request_start',
        requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      }),
    );

    // Log response on finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const tenantId = this.cls.isActive() ? this.cls.get('tenantId') : 'unknown';
      const userId = (req as any).user?.sub || 'anonymous';

      this.logger.log(
        this.serialize({
          event: 'http_request_complete',
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: duration,
          tenantId,
          userId,
        }),
      );
    });

    next();
  }
}
