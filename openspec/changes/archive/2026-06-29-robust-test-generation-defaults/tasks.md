## 1. Generator platform rules (`prompt-builder.ts`)

- [x] 1.1 Extend `platformRulesPro` with: assert the effect of state-changing actions (exact if controlled, else relative/directional/range/format)
- [x] 1.2 Extend `platformRulesPro` selector rule: priority test-id/data > role+name/label/text > CSS class last; forbid index/`nth-child`/`nth-of-type` and auto-generated/hashed classes; prefer container scoping + text over positional paths
- [x] 1.3 Extend `platformRulesPro`: target the project base URL (`project.base_url`), never hard-code a full origin
- [x] 1.4 Extend `platformRulesPro`: prefer invariants/range/format over exact values for dynamic/generated/time-dependent data; no trivial container/orchestrator assertions
- [x] 1.5 Keep flagged-states authoritative: state explicitly that a tester-flagged explicit value is asserted exactly and overrides the invariant default
- [x] 1.6 Add the selector + base-URL subset to `platformRulesFlash` (replay scripts keep assertions optional, so soften the assert-effect rule there)

## 2. Verification

- [x] 2.1 Typecheck API (`tsc -p apps/api/tsconfig.json --noEmit`)
- [x] 2.2 Run codegen prompt-builder unit tests if present; otherwise add/extend a test asserting the new rules appear in the built system prompt
- [x] 2.3 Confirm no DTO/schema/route/migration change and the output contract (single test file) is unchanged
