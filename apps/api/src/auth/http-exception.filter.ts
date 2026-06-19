import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ErrorCode } from '@qassistant/shared/enums';
import { AppException } from './errors.js';

/**
 * Renders every error as the standard contract envelope
 * { error: { code, message, details? } } (section 4). Maps Nest's built-in
 * HTTP exceptions to the closest contract code; AppException carries its code
 * directly.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      res.status(exception.getStatus()).json({
        error: { code: exception.code, message: messageOf(exception), details: exception.details },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({
        error: { code: codeForStatus(status), message: messageOf(exception) },
      });
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'validation_failed', message: 'Internal server error' },
    });
  }
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return 'unauthenticated';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    default:
      return 'validation_failed';
  }
}

function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    if (typeof r.message === 'string') return r.message;
    if (Array.isArray(r.message)) return r.message.join('; ');
  }
  return exception.message;
}
