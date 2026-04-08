import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

/**
 * Global exception filter that converts unhandled errors into consistent JSON
 * responses and prevents raw stack-traces from leaking to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls: ClsService) {}

  private serialize(data: Record<string, unknown>): string {
    return JSON.stringify(data);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.mapException(exception);

    // Always log full details server-side
    const clsRequestId = this.cls.isActive()
      ? this.cls.get<string>('requestId')
      : undefined;
    const requestId = (request as any).requestId || clsRequestId || 'unknown';

    this.logger.error(
      this.serialize({
        event: 'http_request_error',
        requestId,
        method: request.method,
        path: request.url,
        statusCode: status,
        message:
          exception instanceof Error ? exception.message : String(exception),
      }),
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      statusCode: status,
      ...body,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    });
  }

  private mapException(exception: unknown): {
    status: number;
    body: Record<string, unknown>;
  } {
    // ── NestJS / standard HTTP exceptions ──────────────────────────────
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const body =
        typeof res === 'string'
          ? { message: res }
          : (res as Record<string, unknown>);
      return { status, body };
    }

    // ── Prisma known-request errors ────────────────────────────────────
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaError(exception);
    }

    // ── Prisma validation errors ───────────────────────────────────────
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { message: 'Invalid data provided.' },
      };
    }

    // ── Everything else → 500 (never leak internals) ───────────────────
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { message: 'Internal server error' },
    };
  }

  private mapPrismaError(
    error: Prisma.PrismaClientKnownRequestError,
  ): { status: number; body: Record<string, unknown> } {
    switch (error.code) {
      // Record not found
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { message: 'The requested resource was not found.' },
        };

      // Unique-constraint violation
      case 'P2002': {
        const fields = (error.meta?.target as string[]) ?? [];
        return {
          status: HttpStatus.CONFLICT,
          body: {
            message: `A record with the same value already exists.`,
            fields,
          },
        };
      }

      // Foreign-key constraint violation
      case 'P2003': {
        const field = (error.meta?.field_name as string) ?? 'unknown';
        return {
          status: HttpStatus.BAD_REQUEST,
          body: {
            message: `Related record not found for field '${field}'.`,
          },
        };
      }

      // Required record not found (delete/update)
      case 'P2001':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { message: 'Record to update or delete does not exist.' },
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { message: 'A database error occurred.' },
        };
    }
  }
}
