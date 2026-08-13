/**
 * Lightweight i18n for the extension popup. The dashboard has its own React
 * hook; the extension is a separate bundle, so it ships this tiny standalone
 * module. Language follows the browser (`navigator.language`) but can be
 * overridden by the same key the dashboard uses
 * (`localStorage['qassistant:lang']`), falling back to English.
 */

export type Lang = 'en' | 'fr';

const STORAGE_KEY = 'qassistant:lang';

/**
 * Resolve the active language: manual override in localStorage first, then the
 * browser locale, then English. Access to `localStorage` is guarded because the
 * popup may in theory run in a context where it throws.
 */
export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'fr') return stored;
  } catch {
    /* localStorage unavailable — fall through to browser detection */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
  return nav?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const translations: Record<Lang, Record<string, string>> = {
  en: {
    // sign-in
    'signin.email.label': 'Email',
    'signin.email.placeholder': 'you@company.com',
    'signin.password.label': 'Password',
    'signin.password.placeholder': 'Password',
    'signin.tenant.label': 'Tenant',
    'signin.tenant.placeholder': 'tenant slug (blank for super-admin)',
    'signin.submit': 'Sign in',
    'signin.error.missing': 'Enter your email and password',
    // password change
    'password.new.label': 'New password',
    'password.new.placeholder': 'New password',
    'password.confirm.label': 'Confirm',
    'password.confirm.placeholder': 'Confirm new password',
    'password.submit': 'Set new password',
    'password.hint': 'You must set a new password before recording.',
    'password.requirements':
      'At least 8 characters, including an uppercase letter, a lowercase letter, a number, and a special character.',
    'password.mismatch': 'Passwords do not match',
    // session start
    'start.project.label': 'Project',
    'start.jira.label': 'Jira ID',
    'start.jira.placeholder': 'PROJ-123 (optional)',
    'start.description.label': 'Description',
    'start.description.placeholder': 'What are you testing? (used if no Jira ID)',
    'start.screenshot.label': 'Capture screenshots',
    'start.hint':
      'Provide a Jira ID (validated live) or a description. Screenshots default to the project setting; override per session here.',
    'start.submit': 'Start recording',
    'start.starting': 'Starting...',
    'start.error.context': 'Enter a Jira ID or a non-empty description',
    'start.noProjects': 'No active projects available for your tenant.',
    'start.loadFailed': 'Could not load projects.',
    // active recording
    'active.recording': 'Recording',
    'active.project': 'Project: {name}',
    'active.context': 'Context: {context}',
    'active.contextJira': 'Jira {id}',
    'active.screenshots': 'Screenshots: {state} · Flag hotkey: Alt+Shift+F',
    'active.screenshots.on': 'on',
    'active.screenshots.off': 'off',
    'active.stat.domChunks': 'DOM chunks',
    'active.stat.shots': 'Shots',
    'active.stat.flags': 'Flags',
    'active.stop': 'Stop recording',
    'active.stopping': 'Stopping...',
    // shared
    'common.signOut': 'Sign out',
    'msg.superAdmin': 'Super-admins cannot record sessions. Sign in as an admin or qa-engineer.',
  },
  fr: {
    // sign-in
    'signin.email.label': 'E-mail',
    'signin.email.placeholder': 'vous@entreprise.com',
    'signin.password.label': 'Mot de passe',
    'signin.password.placeholder': 'Mot de passe',
    'signin.tenant.label': 'Organisation',
    'signin.tenant.placeholder': "identifiant d'organisation (vide pour super-admin)",
    'signin.submit': 'Se connecter',
    'signin.error.missing': 'Saisissez votre e-mail et votre mot de passe',
    // password change
    'password.new.label': 'Nouveau mot de passe',
    'password.new.placeholder': 'Nouveau mot de passe',
    'password.confirm.label': 'Confirmer',
    'password.confirm.placeholder': 'Confirmer le nouveau mot de passe',
    'password.submit': 'Définir le mot de passe',
    'password.hint': 'Vous devez définir un nouveau mot de passe avant d\'enregistrer.',
    'password.requirements':
      'Au moins 8 caractères, dont une majuscule, une minuscule, un chiffre et un caractère spécial.',
    'password.mismatch': 'Les mots de passe ne correspondent pas',
    // session start
    'start.project.label': 'Projet',
    'start.jira.label': 'ID Jira',
    'start.jira.placeholder': 'PROJ-123 (optionnel)',
    'start.description.label': 'Description',
    'start.description.placeholder': 'Que testez-vous ? (utilisé si aucun ID Jira)',
    'start.screenshot.label': "Capturer des captures d'écran",
    'start.hint':
      "Fournissez un ID Jira (validé en direct) ou une description. Les captures d'écran suivent le paramètre du projet ; modifiable par session ici.",
    'start.submit': "Démarrer l'enregistrement",
    'start.starting': 'Démarrage...',
    'start.error.context': 'Saisissez un ID Jira ou une description non vide',
    'start.noProjects': 'Aucun projet actif disponible pour votre organisation.',
    'start.loadFailed': 'Impossible de charger les projets.',
    // active recording
    'active.recording': 'Enregistrement',
    'active.project': 'Projet : {name}',
    'active.context': 'Contexte : {context}',
    'active.contextJira': 'Jira {id}',
    'active.screenshots': "Captures d'écran : {state} · Raccourci de signalement : Alt+Maj+F",
    'active.screenshots.on': 'activées',
    'active.screenshots.off': 'désactivées',
    'active.stat.domChunks': 'Blocs DOM',
    'active.stat.shots': 'Captures',
    'active.stat.flags': 'Signalements',
    'active.stop': "Arrêter l'enregistrement",
    'active.stopping': 'Arrêt...',
    // shared
    'common.signOut': 'Se déconnecter',
    'msg.superAdmin':
      "Les super-admins ne peuvent pas enregistrer de sessions. Connectez-vous en tant qu'admin ou qa-engineer.",
  },
};

/**
 * Translate `key` for the active language, falling back to English and then to
 * the raw key. `{name}`-style placeholders are interpolated from `params`.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = detectLang();
  const template = translations[lang][key] ?? translations.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
