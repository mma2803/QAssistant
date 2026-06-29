/**
 * @qassistant/shared
 *
 * Single source of truth for enum constants, zod schemas, inferred TS types,
 * and REST request/response DTOs. Consumed by apps/api, apps/dashboard, and
 * apps/extension. Mirrors the data-model-and-api-contract.md.
 */
export * from './enums.js';
export * from './common.js';
export * from './entities.js';
export * from './knowledge.js';
export * from './dto/index.js';
