# E2E Coverage

Generated after a successful `npm run test:e2e` run.

| Surface | Covered | Inventory | Coverage | Target |
|---|---:|---:|---:|---:|
| Frontend screens and states | 12 | 12 | 100% | 80% |
| API controller routes | 42 | 42 | 100% | 80% |

## Test Granularity

| Layer | Baseline | 3x target | Current | Ratio |
|---|---:|---:|---:|---:|
| browser | 12 | 36 | 37 | 3.08x |
| http | 1 | 3 | 3 | 3x |
| service | 9 | 27 | 27 | 3x |
| rls | 8 | 24 | 24 | 3x |

The browser suite runs the real dashboard and built Chrome extension popup in installed Chrome. The API suite starts the production-compiled Nest application and uses Firebase Auth, PostgreSQL, and fake GCS emulators. PostgreSQL RLS and the service-level MVP journey run in the same command. Missing emulator infrastructure fails the command rather than being counted as coverage.

## Commands

`npm run test:e2e` runs every E2E layer and regenerates this folder only if all tests pass.

Prerequisites are Docker and Google Chrome. The command starts the Docker Compose emulators and waits for their health checks automatically.

`npm run test:e2e:browser` runs Playwright only.

`npm run test:e2e:api` runs HTTP transport, service journey, and RLS suites.
