## Why

Code generation currently hard-codes Playwright across the specs: tests can only be produced as Playwright tests, and even the productivity ranking counts "Playwright tests". Tenants use different stacks (Cypress, Selenium, different languages) and want generated drafts in the framework they actually maintain. Making the target framework selectable — while keeping Playwright as the default — lets each tenant get usable drafts without changing the rest of the pipeline.

## What Changes

- Generation becomes **framework-agnostic**: instead of always producing Playwright, the pipeline produces tests in a **selected test framework and language**. Playwright/TypeScript stays the out-of-the-box default and the fallback when nothing is chosen.
- A **tenant-wide default framework** is introduced, modifiable by **any tenant user** (admin or qa-engineer), not admin-only.
- The dashboard offers, **next to the Generate action**, a selector with **five predefined framework/language options plus a free-form custom entry** (framework + language). Choosing one there is a **per-generation override** that does not change the tenant default.
- The custom free-form value is treated as **untrusted text**: the system generates in it but does not guarantee the model supports it.
- The generated test version records the **framework/language used** in its stored metadata.
- The productivity ranking counts **generated tests** (any framework) instead of "Playwright tests".
- No **BREAKING** change for existing behavior: with no selection, output is identical to today (Playwright/TypeScript).

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `knowledge-and-codegen`: generation is parameterized by a selectable framework/language (tenant default + per-generation override + custom free-form); model routing and draft/review wording generalized from "Playwright tests" to "tests"; stored test metadata gains the framework used.
- `qa-dashboards`: contribution ranking sorts by generated **test** count instead of generated Playwright test count.

## Impact

- **Specs**: `knowledge-and-codegen` (1 rename + 3 modified requirements + 1 new requirement), `qa-dashboards` (1 modified requirement).
- **Data model**: a tenant-level default framework setting; a framework/language field on the generation request and on the stored generated-test version.
- **API**: the code-generation endpoint accepts an optional framework/language override; a tenant-settings endpoint reads/writes the default framework (writable by any tenant user).
- **Dashboard**: framework selector UI next to the Generate button (predefined list + free-form), and a place to change the tenant default.
- **Codegen pipeline**: the prompt/model instructions are parameterized by the chosen framework/language; model tiers (Flash / Gemini 3 Pro) are unchanged.
- **Out of scope (non-goals)**: executing generated tests in any runner; validating that a custom framework is actually supported by the model; per-project (vs per-tenant) framework defaults; repository integration. Generated output remains a reviewable draft, never auto-trusted.
