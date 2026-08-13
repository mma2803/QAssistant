/**
 * i18n strings for the tenant Settings page. Two locales, English
 * (default/fallback) and French, consumed via `t('settings.key')`. Shared
 * strings (save, saving, loading, request failures) reuse the `common.*`
 * namespace and are not duplicated here. The framework/language preset labels
 * come from shared data and are not translated.
 */

export const settings = {
  en: {
    // Page header
    title: 'Settings',

    // Default test framework card
    frameworkCardTitle: 'Default test framework',
    frameworkCardDescription:
      'Used when generating a test, unless overridden per generation. Any team member can change it; it applies tenant-wide.',

    // Framework / language field
    frameworkLanguageLabel: 'Framework / language',
    customOption: 'Custom…',
    frameworkLabel: 'Framework',
    frameworkPlaceholder: 'e.g. WebdriverIO',
    languageLabel: 'Language',
    languagePlaceholder: 'e.g. JavaScript',

    // Default test type field
    testTypeLabel: 'Default test type',
    testTypeUi: 'UI test (from the recorded DOM flow)',
    testTypeBackend: 'Back-end test (from captured API traffic)',

    // Actions & states
    saveDefault: 'Save default',
    saved: 'Saved ✓',
    loading: 'Loading settings…',
    saveError: 'Could not save tenant settings',
  },
  fr: {
    // Page header
    title: 'Paramètres',

    // Default test framework card
    frameworkCardTitle: 'Framework de test par défaut',
    frameworkCardDescription:
      'Utilisé lors de la génération d’un test, sauf s’il est remplacé pour une génération donnée. Tout membre de l’équipe peut le modifier ; il s’applique à toute l’organisation.',

    // Framework / language field
    frameworkLanguageLabel: 'Framework / langage',
    customOption: 'Personnalisé…',
    frameworkLabel: 'Framework',
    frameworkPlaceholder: 'ex. WebdriverIO',
    languageLabel: 'Langage',
    languagePlaceholder: 'ex. JavaScript',

    // Default test type field
    testTypeLabel: 'Type de test par défaut',
    testTypeUi: 'Test UI (à partir du flux DOM enregistré)',
    testTypeBackend: 'Test back-end (à partir du trafic API capturé)',

    // Actions & states
    saveDefault: 'Enregistrer le défaut',
    saved: 'Enregistré ✓',
    loading: 'Chargement des paramètres…',
    saveError: 'Impossible d’enregistrer les paramètres de l’organisation',
  },
} as const;
