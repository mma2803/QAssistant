## 1. Data model

- [ ] 1.1 Add a tenant-level default test framework + language setting (column/table) with a migration; default value Playwright/TypeScript for existing tenants
- [ ] 1.2 Add `framework` + `language` fields to the generated-test version record (stored metadata) with a migration; backfill existing rows as Playwright/TypeScript

## 2. Backend API

- [ ] 2.1 Extend the code-generation endpoint to accept an optional `{ framework, language }` override; when absent, resolve the tenant default
- [ ] 2.2 Add tenant-settings read/write for the default framework/language, authorized for any tenant user (admin OR qa-engineer), tenant-scoped
- [ ] 2.3 Validate/normalize the framework input: accept the 5 predefined options, accept a free-form custom value as untrusted text (length-bounded, sanitized for prompt use)
- [ ] 2.4 Persist the chosen framework/language on the generated test version and in the prompt-input summary

## 3. Codegen pipeline

- [ ] 3.1 Parameterize the generation prompt/model instructions by framework + language (remove hard-coded Playwright wording)
- [ ] 3.2 Keep model tier routing unchanged (Flash for quick/summary, Gemini 3 Pro for real tests)
- [ ] 3.3 Treat the custom free-form framework value as labeled untrusted input (no override of platform rules)

## 4. Dashboard

- [ ] 4.1 Add the framework/language selector next to the Generate button: 5 predefined options + free-form custom entry, defaulting to the tenant default
- [ ] 4.2 Wire per-generation override into the generate request without mutating the tenant default
- [ ] 4.3 Add a control (open to any tenant user) to view/change the tenant default framework/language
- [ ] 4.4 Display the framework/language on each generated test version

## 5. Productivity ranking

- [ ] 5.1 Update the ranking query/label to count generated tests across all frameworks (remove "Playwright" wording)

## 6. Verification

- [ ] 6.1 Test: no selection → output identical to today (Playwright/TypeScript)
- [ ] 6.2 Test: per-generation override produces the chosen framework and leaves the tenant default unchanged
- [ ] 6.3 Test: a qa-engineer (not admin) can change the tenant default and it applies tenant-wide
- [ ] 6.4 Test: custom free-form framework is accepted, recorded, and handled as untrusted input
- [ ] 6.5 Test: generated test metadata and ranking reflect the framework used
