/**
 * Default per-project knowledge hub content. Seeded into a project's
 * `knowledge_md` on creation and backfilled into existing empty hubs. It is
 * surfaced as labeled input context during code generation (it never overrides
 * the generator's platform rules), so it nudges generated tests toward robust
 * patterns from the first run while staying fully editable per project.
 *
 * Kept generic and app-agnostic: no project-specific business examples. The
 * project's base URL is already provided to generation as `project.base_url`,
 * so the template references it rather than asking for it.
 *
 * RENDERING CONSTRAINT: the dashboard knowledge hub uses a minimal markdown
 * renderer (apps/dashboard/src/lib/markdown.ts) that does NOT support nested
 * lists or wrapped list items (a list item must be a single physical line, or
 * its continuation renders as a stray paragraph). So: one bullet = one line, no
 * sub-bullets, no blockquotes.
 *
 * IMPORTANT: migration 0007 copies this text inline to backfill existing rows.
 * If you change the canonical text here, the historical migration stays as-is
 * (migrations are point-in-time snapshots) — only new seeds use the new text.
 */
export const DEFAULT_PROJECT_KNOWLEDGE_MD = `# Test generation guidelines

Default template — adapt it to this project. This text guides how QAssistant generates tests for this project; it is guidance only and never overrides the platform's generation rules.

## Environment
- Target the project's configured base URL (already provided to generation as \`project.base_url\`); never hard-code full URLs in tests.
- Read any login from environment variables; never hard-code credentials or secrets.

## Selectors (most robust first)
1. data-test / data-testid / data-cy attributes.
2. Accessible role + name, label, or visible text.
3. CSS class only as a last resort.
- Never use positional selectors (index / nth-child) or auto-generated/hashed class names.

## Assertions — state relations and invariants over hardcoded values
- Avoid non-deterministic values: do not assert exact values for dynamic, generated, or time-dependent data (IDs, timestamps, calculated metrics, random tokens).
- Directional invariant: compare state before and after an operation and assert it increases, decreases, or stays unchanged (e.g. after > before).
- Mathematical invariant: assert relationships with bounded tolerances or ratios rather than hard values (e.g. after equals before times a known factor, within a small margin).
- Contracts and formats when exact values are unpredictable: type correctness (array, object, boolean), structural format (regex, UUID, ISO date), and range boundaries (e.g. within 0 to 100, or string length greater than 0).
- Exact matches by exception only: assert exact values solely for strict business constants, configuration flags, or inputs explicitly mocked or controlled in the test.
- Eliminate noise: never assert on generic orchestrators, structural containers, or implicit lifecycle side-effects that do not directly prove the test case.

## Waiting
- Wait on a meaningful confirmation state, not fixed sleeps.

## Project-specific notes
- Add your conventions here: design system, custom test-id scheme, business rules, and anything app-specific.
`;
