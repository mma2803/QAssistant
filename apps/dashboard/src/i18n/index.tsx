import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { translations, type Lang } from './translations';

/**
 * Lightweight in-house i18n (no external dependency). The active language is
 * resolved from a persisted override, falling back to the browser language
 * (`navigator.language`): anything starting with "fr" → French, everything
 * else → English (the default). A manual selector persists an override in
 * localStorage. Strings live in ./translations as nested `en`/`fr` dictionaries;
 * `t('a.b.c')` resolves a dot path and interpolates `{name}` placeholders.
 */

const STORAGE_KEY = 'qassistant:lang';

export type { Lang };

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'fr') return stored;
  } catch {
    /* localStorage unavailable — fall back to the browser language */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

function resolve(dict: Record<string, unknown>, key: string): string | undefined {
  const found = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, dict);
  return typeof found === 'string' ? found : undefined;
}

type TParams = Record<string, string | number>;
export type TFunc = (key: string, params?: TParams) => string;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    try {
      document.documentElement.lang = lang;
    } catch {
      /* no document (tests) */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback<TFunc>(
    (key, params) => {
      const raw = resolve(translations[lang], key) ?? resolve(translations.en, key) ?? key;
      if (!params) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
        params[name] !== undefined ? String(params[name]) : `{${name}}`,
      );
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Convenience hook when only the translate function is needed. */
export function useT(): TFunc {
  return useI18n().t;
}
