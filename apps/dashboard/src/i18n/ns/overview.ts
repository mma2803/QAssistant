/**
 * i18n strings for the Overview (landing) page. Two locales, English (default/
 * fallback) and French, consumed via `t('overview.key')`. Numbers and dates use
 * the existing formatting helpers and are not translated here.
 */

export const overview = {
  en: {
    welcome: 'Welcome back 👋',
    recordings: 'Recordings',
    recordingsSub: 'Most recent 100',
    activeSessions: 'Active sessions',
    testsGenerated: 'Tests generated',
    integrated: 'Integrated',
    successRate: '{rate}% success rate',
    noAttempts: 'No attempts yet',
    recordingsOverTime: 'Recordings over time',
    last14Days: 'Last 14 days.',
    recentRecordings: 'Recent recordings',
    latestSessions: 'Your latest sessions.',
    noRecordings: 'No recordings yet.',
    noContext: 'No context',
    generatedTestTypes: 'Generated test types',
    uiVsBackend: 'UI vs back-end across recent sessions.',
    noTests: 'No tests generated yet.',
    integrationStatus: 'Integration status',
    candidateStand: 'Where your candidate tests stand.',
  },
  fr: {
    welcome: 'Bon retour 👋',
    recordings: 'Enregistrements',
    recordingsSub: 'Les 100 plus récents',
    activeSessions: 'Sessions actives',
    testsGenerated: 'Tests générés',
    integrated: 'Intégrés',
    successRate: '{rate} % de réussite',
    noAttempts: 'Aucune tentative pour le moment',
    recordingsOverTime: 'Enregistrements au fil du temps',
    last14Days: '14 derniers jours.',
    recentRecordings: 'Enregistrements récents',
    latestSessions: 'Vos dernières sessions.',
    noRecordings: 'Aucun enregistrement pour le moment.',
    noContext: 'Aucun contexte',
    generatedTestTypes: 'Types de tests générés',
    uiVsBackend: 'UI vs back-end sur les sessions récentes.',
    noTests: 'Aucun test généré pour le moment.',
    integrationStatus: "Statut d'intégration",
    candidateStand: 'État de vos tests candidats.',
  },
} as const;
