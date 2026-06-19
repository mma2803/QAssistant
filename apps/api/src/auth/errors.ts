import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@qassistant/shared/enums';

/**
 * Domain exceptions carrying a contract error code (section 4 envelope). The
 * global exception filter maps these to { error: { code, message, details? } }.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

/** 403 with the must_change_password code; raised by the auth guard. */
export class MustChangePasswordException extends AppException {
  constructor() {
    super(
      'must_change_password',
      'Password change required before accessing this resource',
      HttpStatus.FORBIDDEN,
    );
  }
}
