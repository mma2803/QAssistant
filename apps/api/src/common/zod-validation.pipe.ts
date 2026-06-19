import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import { AppException } from '../auth/errors.js';

/**
 * Validates a request payload (body / query / param) against a shared Zod
 * schema (contract section 4: "Input validation via shared Zod schemas in
 * packages/shared"). On failure it raises the contract error envelope with
 * code `validation_failed` and the flattened field issues in `details`.
 *
 * Usage: `@Body(new ZodValidationPipe(createUserRequestSchema)) body: CreateUserRequest`.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): ZodInfer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        'validation_failed',
        'Request validation failed',
        HttpStatus.BAD_REQUEST,
        { issues: result.error.flatten() },
      );
    }
    return result.data;
  }
}
