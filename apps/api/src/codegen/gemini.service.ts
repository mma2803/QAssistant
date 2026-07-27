import { Inject, Injectable } from '@nestjs/common';
import type { ModelTier } from '@qassistant/shared/enums';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * Gemini client + model-tier routing (spec "Gemini model routing"; design D8).
 *
 * Tier -> model id is resolved from config (GEMINI_MODEL_FLASH / GEMINI_MODEL_PRO),
 * never hard-coded, so the live Flash/Pro models in the project are used and can
 * be swapped without a code change. The resolved id is recorded per generation
 * (generated_tests.model_id).
 *
 * Two drivers behind one interface so the worker runs offline:
 *   - 'genai' : @google/genai (Gemini Developer API, API key from env / Secret
 *               Manager). Loaded dynamically so the package is an optional dep.
 *   - 'fake'  : a deterministic local generator that emits a plausible Playwright
 *               test / replay script from the structured prompt, so codegen runs
 *               end-to-end with no network and no API key. Selected automatically
 *               when GEMINI_API_KEY is unset.
 */

/** A built prompt: platform instructions kept separate from labeled untrusted inputs (D8b). */
export interface ModelPrompt {
  /** Trusted platform/system instructions. Never mixed with untrusted data. */
  system: string;
  /** The user turn: labeled, redacted, untrusted source blocks. */
  user: string;
}

export interface GenerateOptions {
  tier: ModelTier;
  prompt: ModelPrompt;
}

export interface GenerateResult {
  /** The generated code (TypeScript). */
  code: string;
  /** The resolved model id actually used (recorded on the row). */
  modelId: string;
}

export interface GeminiClient {
  /** Resolve the configured model id for a tier without generating. */
  modelIdForTier(tier: ModelTier): string;
  /** Run generation for the given tier + prompt and return code + model id. */
  generate(opts: GenerateOptions): Promise<GenerateResult>;
}

export const GEMINI_CLIENT = Symbol('GEMINI_CLIENT');

/** Reject if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Gemini call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Strip a leading/trailing markdown code fence the model may wrap code in. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/;
  const m = trimmed.match(fence);
  return (m && m[1] !== undefined ? m[1] : trimmed).trim();
}

/**
 * Live Gemini client over @google/genai. The package is imported dynamically so
 * the API only loads it when GEMINI_API_KEY is present; offline/local builds use
 * the fake client below.
 */
@Injectable()
export class GenAiGeminiClient implements GeminiClient {
  private client: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  modelIdForTier(tier: ModelTier): string {
    return tier === 'pro' ? this.config.GEMINI_MODEL_PRO : this.config.GEMINI_MODEL_FLASH;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import('@google/genai' as string);
    this.client = new mod.GoogleGenAI({ apiKey: this.config.GEMINI_API_KEY });
    return this.client;
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const modelId = this.modelIdForTier(opts.tier);
    const client = await this.getClient();
    // Hard timeout: the codegen poller runs jobs on a shared event loop with no
    // per-job process isolation, so a stuck model call must not be able to pin
    // the poller (or a request handler, for the synchronous 'inline' driver)
    // indefinitely on a memory-constrained single VPS.
    const response = await withTimeout<any>(
      client.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: opts.prompt.user }] }],
        config: {
          systemInstruction: opts.prompt.system,
          temperature: opts.tier === 'pro' ? 0.2 : 0.4,
        },
      }),
      this.config.GEMINI_TIMEOUT_MS,
    );
    const text: string =
      typeof response?.text === 'string'
        ? response.text
        : (response?.candidates?.[0]?.content?.parts ?? [])
            .map((p: any) => p?.text ?? '')
            .join('');
    return { code: stripCodeFence(text), modelId };
  }
}

/**
 * Deterministic offline client. Produces a syntactically plausible Playwright
 * test (pro) or replay script (flash) from the prompt's user block so the full
 * codegen path runs with no network. It does NOT phone home and is the default
 * whenever GEMINI_API_KEY is unset.
 */
@Injectable()
export class FakeGeminiClient implements GeminiClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  modelIdForTier(tier: ModelTier): string {
    // Even the fake records a configured id so model_id is always meaningful.
    return tier === 'pro' ? this.config.GEMINI_MODEL_PRO : this.config.GEMINI_MODEL_FLASH;
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const modelId = this.modelIdForTier(opts.tier);
    const code =
      opts.tier === 'pro' ? this.fakePlaywrightTest(opts) : this.fakeReplayScript(opts);
    return { code, modelId };
  }

  private fakePlaywrightTest(opts: GenerateOptions): string {
    // Surface a short, non-secret excerpt of the labeled inputs as a comment so
    // the offline output visibly reflects its grounding (and tests can assert it).
    const excerpt = opts.prompt.user.split('\n').slice(0, 4).join(' ').slice(0, 120);
    return [
      "import { test, expect } from '@playwright/test';",
      '',
      `// Generated offline (no GEMINI_API_KEY). Grounded in: ${excerpt}`,
      "test('generated flow', async ({ page }) => {",
      '  await page.goto(process.env.BASE_URL ?? "/");',
      '  // Replay of captured interactions would be emitted here.',
      '  await expect(page).toHaveURL(/.*/);',
      '});',
      '',
    ].join('\n');
  }

  private fakeReplayScript(opts: GenerateOptions): string {
    const excerpt = opts.prompt.user.split('\n').slice(0, 2).join(' ').slice(0, 100);
    return [
      "import { chromium } from 'playwright';",
      '',
      `// Quick replay script generated offline. Grounded in: ${excerpt}`,
      'async function replay() {',
      '  const browser = await chromium.launch();',
      '  const page = await browser.newPage();',
      '  await page.goto(process.env.BASE_URL ?? "/");',
      '  // Replay of captured DOM interactions would be emitted here.',
      '  await browser.close();',
      '}',
      '',
      'replay();',
      '',
    ].join('\n');
  }
}
