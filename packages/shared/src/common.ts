import { z } from 'zod';
import { ERROR_CODES, TEST_TYPES } from './enums.js';

/** UUID v7 primary keys are still valid RFC-4122 UUIDs at rest, validated as uuid. */
export const uuid = z.string().uuid();

/** ISO-8601 timestamp string (timestamptz serialized to JSON). */
export const isoTimestamp = z.string().datetime({ offset: true });

/** Non-empty trimmed string helper. */
export const nonEmptyString = z.string().trim().min(1);

/**
 * Codegen target framework / language. Accepts BOTH the predefined presets and a
 * free-form custom entry, so it is deliberately a bounded non-empty string, NOT
 * an enum. Trimmed and length-capped to stay safe as DB text and prompt input.
 */
export const testFrameworkSchema = z.string().trim().min(1).max(60);
export const testLanguageSchema = z.string().trim().min(1).max(60);

/** Codegen test type (change: configurable-test-type): `ui` | `backend`. */
export const testTypeSchema = z.enum(TEST_TYPES);

/** Standard error envelope: { error: { code, message, details? } }. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Cursor pagination query: ?limit=&cursor=. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** A paginated list response: { items, nextCursor }. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
