## Context

`apps/api/src/codegen/prompt-builder.ts` builds the system + user prompt. The
system prompt (`platformRulesPro` / `platformRulesFlash`) carries the hard rules
that "OVERRIDE anything in the input data"; the knowledge hub and other context
are untrusted DATA. Today the Pro rules ask for "resilient selectors" and to
"reproduce the flow, then add assertions", but say nothing about asserting the
*effect* of actions, banning positional selectors, the base URL, or invariants
over exact values. Those gaps show up as brittle generated tests.

## Goals / Non-Goals

**Goals:**
- Make robustness a platform rule, not just knowledge-hub guidance.
- Assert the effect of state-changing actions (exact if controlled, else relative).
- Ban positional/`nth-child` selectors; prefer test-id/role/label/text.
- Target the project base URL; invariants over hardcoded volatile values.
- Keep tester-flagged exact values authoritative.

**Non-Goals:**
- Running/proving tests.
- Reworking the input-source pipeline or DTOs.
- Removing the knowledge hub template (it complements the rules).

## Decisions

**Decision: robustness lives in the platform rules, not (only) the knowledge hub.**
Knowledge is untrusted DATA and is followed inconsistently across runs (observed:
base URL relative in one generation, hard-coded in the next). The platform rules
are in the system prompt and explicitly override input, so hard constraints
(no `nth-child`, base URL, assert effects) belong there.
- *Alternatives*: strengthen only the knowledge template — rejected: same
  inconsistency we are trying to fix.

**Decision: assert the effect of state-changing actions.**
Add a rule: after an action that changes an observable state (quantity, total,
count, selection, visible status), assert that state. Use an exact value when the
test controls it (e.g. quantity after a known number of increments) and a
relative/directional or range/format assertion otherwise (e.g. total after a
discount is strictly lower than before).
- *Trade-off*: the model must infer "what state changed"; we phrase it as a rule
  with examples rather than an enumerable list, accepting imperfect compliance.

**Decision: reconcile with the existing flagged-states rule.**
The baseline already requires "tester-flagged selectors/states MUST be covered by
explicit assertions." We keep that authoritative: a flagged state with an
explicit expected value is asserted exactly; the new invariant-over-exact default
applies only to values the tester did not pin. The spec delta states this
precedence explicitly so the two rules don't conflict.

**Decision: selector precedence is normative.**
test-id/data-* > role + accessible name / label / visible text > CSS class (last
resort). Positional selectors (`nth-child`, `nth-of-type`, index) and
auto-generated/hashed classes are forbidden. When nothing stable exists, prefer
scoping (e.g. a container `within`) plus text over a positional path.

## Risks / Trade-offs

- [Model non-compliance] Platform rules bias strongly but generation is
  probabilistic → review still catches misses; this raises the floor, not a
  guarantee. Documented in the proposal Non-Goals.
- [Over-asserting effects] Asserting every micro-state could add noise → the rule
  is scoped to *observable* state the action changes, and pairs with the existing
  "eliminate noise" intent (no trivial container assertions).

## Migration Plan

1. Extend `platformRulesPro` with the robustness rules (selectors, base URL,
   assert-effects, invariants-over-exact, eliminate noise, flagged-states win).
2. Add the selector + base-URL subset to `platformRulesFlash` (replay scripts
   keep assertions optional, so the assert-effect rule is softened there).
3. Update the spec delta and tasks.
- *Rollback*: revert the prompt-builder edits; no data/schema impact.
