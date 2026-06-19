# Test Granularity

The coverage gate enforces at least 3x the original independently reported test cases on every E2E layer.

| Layer | Baseline | Required | Current | Ratio | Result |
|---|---:|---:|---:|---:|---|
| browser | 12 | 36 | 37 | 3.08x | PASS |
| http | 1 | 3 | 3 | 3x | PASS |
| service | 9 | 27 | 27 | 3x | PASS |
| rls | 8 | 24 | 24 | 3x | PASS |

Counts are derived from Playwright `test(...)` declarations and Node test-runner `it(...)` declarations. The gate runs after every successful `npm run test:e2e` execution.
