/**
 * i18n strings for the Productivity / Metrics page. Two locales, English
 * (default/fallback) and French, consumed via `t('metrics.key')`. Shared strings
 * (loading, request failures, table column headers) reuse the `common.*`
 * namespace and are not duplicated here. Numbers, durations and dates use the
 * existing formatting helpers and are not translated.
 */

export const metrics = {
  en: {
    title: 'Productivity',

    // Time-window filter
    window24h: 'Last 24 hours',
    window48h: 'Last 48 hours',
    window7d: 'Last 7 days',
    window30d: 'Last 30 days',
    windowCustom: 'Custom range',

    // Summary stat cards
    activeTesters: 'Active testers',
    generatedTests: 'Generated tests',
    avgPerTester: '{avg} avg / tester',
    recordings: 'Recordings',
    totalRecordingTime: 'Total recording time',
    rawWallClock: 'Raw wall-clock',

    // States
    loadFailed: 'Could not load metrics',
    noActivity: 'No activity in this period.',
    noRecordings: 'No recordings in this period.',

    // Coverage
    coverageTitle: 'Test coverage',
    coverageRecordingsWithTest: 'Recordings turned into a test',
    coverageCandidatesIntegrated: 'Candidate tests integrated',
    coverageProjectsWithActivity: 'Projects with activity',

    // Charts
    topTesters: 'Top testers',
    projectActivity: 'Project activity',

    // Ranking table
    rankingTitle: 'Contribution ranking',
    colRank: 'Rank',
    colTester: 'Tester',
    colRecordingTime: 'Recording time',

    // Footnote
    footnote:
      'Directional, not an absolute performance score. Recording duration is raw wall-clock (idle time is not excluded in this MVP). Aggregated from recordings in the selected window.',
  },
  fr: {
    title: 'Productivité',

    // Time-window filter
    window24h: '24 dernières heures',
    window48h: '48 dernières heures',
    window7d: '7 derniers jours',
    window30d: '30 derniers jours',
    windowCustom: 'Période personnalisée',

    // Summary stat cards
    activeTesters: 'Testeurs actifs',
    generatedTests: 'Tests générés',
    avgPerTester: '{avg} en moy. / testeur',
    recordings: 'Enregistrements',
    totalRecordingTime: "Temps d'enregistrement total",
    rawWallClock: 'Temps réel brut',

    // States
    loadFailed: 'Impossible de charger les métriques',
    noActivity: 'Aucune activité sur cette période.',
    noRecordings: 'Aucun enregistrement sur cette période.',

    // Coverage
    coverageTitle: 'Couverture des tests',
    coverageRecordingsWithTest: 'Enregistrements convertis en test',
    coverageCandidatesIntegrated: 'Tests candidats intégrés',
    coverageProjectsWithActivity: 'Projets avec activité',

    // Charts
    topTesters: 'Meilleurs testeurs',
    projectActivity: 'Activité par projet',

    // Ranking table
    rankingTitle: 'Classement des contributions',
    colRank: 'Rang',
    colTester: 'Testeur',
    colRecordingTime: "Temps d'enregistrement",

    // Footnote
    footnote:
      "Indicatif, et non un score de performance absolu. La durée d'enregistrement est le temps réel brut (le temps d'inactivité n'est pas exclu dans ce MVP). Agrégé à partir des enregistrements de la période sélectionnée.",
  },
} as const;
