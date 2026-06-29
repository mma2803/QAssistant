## Why

Generated tests reproduce the recorded interaction flow but often (a) perform an
action without asserting its effect (e.g. clicking the quantity increment without
checking the quantity changed, applying a promo without checking the total
dropped), (b) fall back to positional `nth-child` selectors when no test-id
exists, and (c) hard-code the full app URL. The per-project knowledge template
nudges toward better patterns, but knowledge is untrusted input and is followed
inconsistently. The reliable lever for these hard constraints is the generator's
own platform rules (the system prompt, which overrides input data).

## What Changes

- **Assert the effect of state-changing actions**: when the flow performs an
  action that changes an observable state (quantity, total, count, selection),
  the generated test SHALL assert that resulting state — exact when the value is
  controlled by the test (e.g. quantity after N increments), relative/directional
  otherwise (e.g. total after a discount is lower than before).
- **Resilient selectors, no positional ones**: prefer test-id/role/label/text;
  CSS class only as a last resort; never emit index/`nth-child`/`nth-of-type` or
  auto-generated/hashed class selectors.
- **Target the project base URL**: never hard-code a full origin; the base URL is
  already provided to generation as `project.base_url`.
- **State relations & invariants over hardcoded values**: do not assert exact
  values for dynamic/generated/time-dependent data; assert invariants, ranges,
  or formats instead. Exact values only for controlled inputs or strict
  constants.
- **Eliminate noise**: no trivial assertions on structural containers
  (`#root`, `body`) or generic orchestrators that don't prove the test case.
- **Flagged states still win**: a tester-flagged state with an explicit expected
  value is still asserted exactly — the robustness defaults apply to everything
  the tester did not pin.

These are added to the generator's platform rules in `prompt-builder.ts`
(`platformRulesPro`, and the relevant subset to `platformRulesFlash`).

## Capabilities

### Modified Capabilities
- `knowledge-and-codegen`: context-grounded generation gains robustness defaults
  — assert the effect of state-changing actions, resilient/non-positional
  selectors, base-URL targeting, invariants over hardcoded volatile values, and
  noise elimination — while tester-flagged exact values still take precedence.

## Impact

- **API**: `apps/api/src/codegen/prompt-builder.ts` platform rules extended. No
  DTO, schema, route, or migration change.
- **Behavior**: generated test content becomes more robust by default; existing
  generated versions are unchanged (regenerate to pick up the new rules).
- **No contract change**: same generate/regenerate endpoints, same output shape
  (a single test file).

## Non-Goals

- Executing or proving the generated tests (covered elsewhere; the client runs
  them at integration time).
- Per-framework rule variants beyond what the framework/language interpolation
  already provides.
- Guaranteeing the model always complies — platform rules strongly bias output
  but generation remains probabilistic; review still applies.
