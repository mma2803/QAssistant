/**
 * Démo back-end (change: configurable-test-type) — SANS infra (ni DB, ni serveur,
 * ni Gemini). Montre ce que le change ajoute côté back-end :
 *   1. la cascade de résolution du type de test (override → projet → tenant → 'ui'),
 *   2. le PROMPT back-end réellement construit à partir d'un trafic réseau capturé,
 *      avec masquage des secrets,
 *   3. le résumé d'inputs (testType + sources) stocké sur la version générée,
 *   4. le code généré par le client Gemini *simulé* (placeholder hors clé API).
 *
 * Lancer :  cd apps/api && node --import tsx scripts/demo-backend-test.ts
 *
 * NB : pour un vrai test d'API produit par le LLM, il faut GEMINI_API_KEY.
 *      Le flux complet « enregistrer une session → capturer le réseau » nécessite
 *      l'extension (section 4, pas encore implémentée).
 */
import { resolveTestType } from '../src/codegen/codegen.service.js';
import { buildPrompt, type LabeledSource } from '../src/codegen/prompt-builder.js';

function hr(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

// --- 1. Cascade de résolution -------------------------------------------------
hr('1. Cascade resolveTestType(override, projet, tenant) → type effectif');
const cases: Array<[string, ReturnType<typeof resolveTestType>]> = [
  ['override=backend, projet=ui,   tenant=ui   ', resolveTestType('backend', 'ui', 'ui')],
  ['override=∅,       projet=backend, tenant=ui ', resolveTestType(undefined, 'backend', 'ui')],
  ['override=∅,       projet=null, tenant=backend', resolveTestType(undefined, null, 'backend')],
  ['override=∅,       projet=null, tenant=null  ', resolveTestType(undefined, null, null)],
];
for (const [label, result] of cases) console.log(`  ${label} → ${result}`);

// --- 2/3/4. Génération back-end à partir d'un trafic réseau capturé -----------
// Texte tel que le worker le construit depuis un artifact network_log. On glisse
// volontairement un header Authorization pour montrer la redaction.
const capturedTraffic = [
  'POST https://api.acme.test/cart/items -> 201',
  '  request headers: authorization: Bearer eyJhbGciOi.J9.secret-token-123; content-type: application/json',
  '  request body: {"sku":"ABC-1","qty":2}',
  '  response headers: content-type: application/json',
  '  response body: {"id":"cart_42","itemCount":2,"total":1990}',
  '',
  'GET https://api.acme.test/cart/cart_42 -> 200',
  '  response body: {"id":"cart_42","itemCount":2,"total":1990,"currency":"EUR"}',
].join('\n');

const sources: LabeledSource[] = [
  {
    label: 'recording.network',
    kind: 'recording',
    text: capturedTraffic,
    note: 'captured HTTP calls; sensitive headers/values redacted',
  },
  { label: 'tester.description', kind: 'description', text: 'Ajouter un article au panier via l’API' },
  { label: 'project.base_url', kind: 'project', text: 'Application base URL: https://api.acme.test' },
];

const built = buildPrompt({
  kind: 'playwright_test',
  tier: 'pro',
  testType: 'backend',
  framework: 'Playwright',
  language: 'TypeScript',
  sources,
});

hr('2. SYSTEM PROMPT back-end (règles API — extrait)');
console.log(built.prompt.system);

hr('3a. USER PROMPT (trafic capturé, secrets masqués)');
console.log(built.prompt.user);

hr('3b. Résumé d’inputs persisté sur la version (promptInputsSummary)');
console.log(JSON.stringify(built.summary, null, 2));

hr('4. Code généré (client Gemini SIMULÉ — placeholder hors GEMINI_API_KEY)');
console.log(
  'Hors clé API, le client simulé émet un squelette générique. Avec GEMINI_API_KEY,\n' +
    'le modèle transforme le SYSTEM + USER prompt ci-dessus en un vrai test d’API.\n' +
    'La preuve du flux complet (network_log → row testType=backend) est dans le test\n' +
    'apps/api/test/configurable-test-type-e2e.test.ts (npm test).',
);

console.log('\n✓ Démo terminée.');
