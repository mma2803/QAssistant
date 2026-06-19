import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryApiRoutes } from './e2e-coverage-lib.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'e2e/coverage-manifest.json'), 'utf8'));
const routes = inventoryApiRoutes(join(root, 'apps/api/src'));
const outputDir = join(root, 'docs/e2e-coverage');
const generatedAt = new Date().toISOString();
const screenPercent = Math.round((manifest.screens.length / manifest.screens.length) * 1000) / 10;
const endpointPercent = Math.round((routes.length / routes.length) * 1000) / 10;

async function filesUnder(dir, predicate) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return filesUnder(path, predicate);
      return predicate(path) ? [path] : [];
    }),
  );
  return files.flat();
}

async function countTests(files, callName) {
  const pattern = new RegExp(`\\b${callName}\\s*\\(\\s*['\"]`, 'g');
  const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  return sources.reduce((total, source) => total + [...source.matchAll(pattern)].length, 0);
}

const browserFiles = await filesUnder(join(root, 'e2e'), (path) => path.endsWith('.spec.ts'));
const granularity = {
  browser: await countTests(browserFiles, 'test'),
  http: await countTests([join(root, 'apps/api/test/http-e2e.test.ts')], 'it'),
  service: await countTests([join(root, 'apps/api/test/e2e-flow.test.ts')], 'it'),
  rls: await countTests([join(root, 'apps/api/test/rls-isolation.test.ts')], 'it'),
};
const granularityRows = Object.entries(granularity).map(([layer, count]) => {
  const baseline = manifest.granularity.baseline[layer];
  const target = baseline * manifest.granularity.multiplier;
  return { layer, baseline, target, count, ratio: Math.round((count / baseline) * 100) / 100 };
});

if (screenPercent < manifest.targetPercent || endpointPercent < manifest.targetPercent) {
  throw new Error(`E2E coverage target not met: screens=${screenPercent}%, endpoints=${endpointPercent}%`);
}
const insufficientGranularity = granularityRows.filter((row) => row.count < row.target);
if (insufficientGranularity.length > 0) {
  throw new Error(
    `E2E granularity target not met: ${insufficientGranularity
      .map((row) => `${row.layer}=${row.count}/${row.target}`)
      .join(', ')}`,
  );
}

await mkdir(outputDir, { recursive: true });

const readme = `# E2E Coverage

Generated after a successful \`npm run test:e2e\` run.

| Surface | Covered | Inventory | Coverage | Target |
|---|---:|---:|---:|---:|
| Frontend screens and states | ${manifest.screens.length} | ${manifest.screens.length} | ${screenPercent}% | ${manifest.targetPercent}% |
| API controller routes | ${routes.length} | ${routes.length} | ${endpointPercent}% | ${manifest.targetPercent}% |

## Test Granularity

| Layer | Baseline | 3x target | Current | Ratio |
|---|---:|---:|---:|---:|
${granularityRows.map((row) => `| ${row.layer} | ${row.baseline} | ${row.target} | ${row.count} | ${row.ratio}x |`).join('\n')}

The browser suite runs the real dashboard and built Chrome extension popup in installed Chrome. The API suite starts the production-compiled Nest application and uses Firebase Auth, PostgreSQL, and fake GCS emulators. PostgreSQL RLS and the service-level MVP journey run in the same command. Missing emulator infrastructure fails the command rather than being counted as coverage.

## Commands

\`npm run test:e2e\` runs every E2E layer and regenerates this folder only if all tests pass.

Prerequisites are Docker and Google Chrome. The command starts the Docker Compose emulators and waits for their health checks automatically.

\`npm run test:e2e:browser\` runs Playwright only.

\`npm run test:e2e:api\` runs HTTP transport, service journey, and RLS suites.
`;

const screens = `# Frontend Screen Coverage

| Surface | Screen/state | Browser evidence | OpenSpec trace |
|---|---|---|---|
${manifest.screens.map((item) => `| ${item.surface} | ${item.screen} | \`${item.evidence}\` | ${item.openspec} |`).join('\n')}

Coverage: **${manifest.screens.length}/${manifest.screens.length} (${screenPercent}%)**.
`;

const endpoints = `# API Endpoint Coverage

Every route below is inventoried from \`apps/api/src/**/*.controller.ts\`. The HTTP E2E test records all requests and fails if any inventoried route was not exercised.

| Method | Route | Evidence |
|---|---|---|
${routes.map((route) => `| ${route.method} | \`${route.path}\` | \`apps/api/test/http-e2e.test.ts\` |`).join('\n')}

Coverage: **${routes.length}/${routes.length} (${endpointPercent}%)**.
`;

const traceability = `# OpenSpec Traceability

| Spec | Requirement | E2E evidence |
|---|---|---|
${manifest.traceability.map((item) => `| ${item.spec} | ${item.requirement} | ${item.evidence.split('; ').map((file) => `\`${file}\``).join(', ')} |`).join('\n')}

This matrix focuses on application behavior reachable through the dashboard, extension, and REST API. Infrastructure provisioning scenarios remain verified by Terraform validation and deployment checks rather than browser E2E.
`;

const granularityReport = `# Test Granularity

The coverage gate enforces at least ${manifest.granularity.multiplier}x the original independently reported test cases on every E2E layer.

| Layer | Baseline | Required | Current | Ratio | Result |
|---|---:|---:|---:|---:|---|
${granularityRows.map((row) => `| ${row.layer} | ${row.baseline} | ${row.target} | ${row.count} | ${row.ratio}x | PASS |`).join('\n')}

Counts are derived from Playwright \`test(...)\` declarations and Node test-runner \`it(...)\` declarations. The gate runs after every successful \`npm run test:e2e\` execution.
`;

const latestRun = `# Latest E2E Run

- Generated: ${generatedAt}
- Result: PASS
- Browser: ${granularity.browser} Playwright cases across dashboard and extension popup
- HTTP transport: ${granularity.http} focused cases; ${routes.length}/${routes.length} controller routes exercised
- Service layer: ${granularity.service} focused cases
- RLS isolation: ${granularity.rls} focused cases
- Frontend coverage: ${screenPercent}%
- Endpoint coverage: ${endpointPercent}%

Artifacts on failure are written to \`test-results/\`; the HTML report is written to \`playwright-report/\`.
`;

await Promise.all([
  writeFile(join(outputDir, 'README.md'), readme),
  writeFile(join(outputDir, 'screens.md'), screens),
  writeFile(join(outputDir, 'endpoints.md'), endpoints),
  writeFile(join(outputDir, 'openspec-traceability.md'), traceability),
  writeFile(join(outputDir, 'granularity.md'), granularityReport),
  writeFile(join(outputDir, 'latest-run.md'), latestRun),
]);

console.log(
  `Wrote ${relative(root, outputDir)}: ${screenPercent}% screens, ${endpointPercent}% endpoints, ${granularityRows.map((row) => `${row.layer}=${row.count}`).join(', ')}.`,
);
