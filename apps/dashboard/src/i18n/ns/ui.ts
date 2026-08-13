/**
 * i18n strings for shared UI components (badges, theme toggle, replay player,
 * auth image). Two locales, English (default/fallback) and French, consumed via
 * `t('ui.key')`.
 */

export const ui = {
  en: {
    // Test-type badge
    testBackend: 'Back-end',
    testUi: 'UI',
    // Integration status labels
    integration_not_ready: 'Not ready',
    integration_ready_to_integrate: 'Ready to integrate',
    integration_integrated: 'Integrated',
    integration_failed_to_integrate: 'Failed to integrate',
    // Theme toggle
    toggleTheme: 'Toggle theme',
    switchToLight: 'Switch to light theme',
    switchToDark: 'Switch to dark theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    lightMode: 'Light mode',
    darkMode: 'Dark mode',
    // Replay player
    replayPlay: 'Play',
    replayPause: 'Pause',
    replaySeek: 'Seek',
    replayFullscreen: 'Fullscreen',
    replayFailedToLoad: 'Failed to load replay player',
    replayCaptured: 'DOM-replay is captured for this recording.',
    replayUseExport: 'Use Export to download the replayable DOM chunks and screenshots.',
    // Auth image
    imageUnavailable: 'Unavailable',
    imageLoading: 'Loading…',
  },
  fr: {
    // Test-type badge
    testBackend: 'Back-end',
    testUi: 'Interface',
    // Integration status labels
    integration_not_ready: 'Non prêt',
    integration_ready_to_integrate: 'Prêt à intégrer',
    integration_integrated: 'Intégré',
    integration_failed_to_integrate: "Échec d'intégration",
    // Theme toggle
    toggleTheme: 'Changer de thème',
    switchToLight: 'Passer au thème clair',
    switchToDark: 'Passer au thème sombre',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    themeSystem: 'Système',
    lightMode: 'Mode clair',
    darkMode: 'Mode sombre',
    // Replay player
    replayPlay: 'Lecture',
    replayPause: 'Pause',
    replaySeek: 'Rechercher',
    replayFullscreen: 'Plein écran',
    replayFailedToLoad: 'Échec du chargement du lecteur de relecture',
    replayCaptured: 'La relecture DOM est enregistrée pour cet enregistrement.',
    replayUseExport:
      'Utilisez Exporter pour télécharger les segments DOM rejouables et les captures d’écran.',
    // Auth image
    imageUnavailable: 'Indisponible',
    imageLoading: 'Chargement…',
  },
} as const;
