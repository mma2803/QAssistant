/**
 * Translations for the admin Users page (UsersPage.tsx). Keys live under the
 * `users.*` namespace. Shared keys (common.*, roles.*, password.*, status.*)
 * are NOT duplicated here — they resolve from the global dictionary.
 */
export const users = {
  en: {
    title: 'Users',
    addUser: 'Add user',
    searchPlaceholder: 'Search by email…',
    allRoles: 'All roles',
    loading: 'Loading users…',
    noMatch: 'No users match your filters.',
    mustChangePassword: 'Must change pw',
    mustChangeYes: 'yes',
    mustChangeNo: 'no',
    resetPassword: 'Reset password',
    disable: 'Disable',
    enable: 'Enable',
    createDescription: 'The new user must change this password on first sign-in.',
    initialPassword: 'Initial password',
    resetPrompt: 'New temporary password for {email}.\n{requirements}',
  },
  fr: {
    title: 'Utilisateurs',
    addUser: 'Ajouter un utilisateur',
    searchPlaceholder: 'Rechercher par e-mail…',
    allRoles: 'Tous les rôles',
    loading: 'Chargement des utilisateurs…',
    noMatch: 'Aucun utilisateur ne correspond à vos filtres.',
    mustChangePassword: 'Changement de MDP requis',
    mustChangeYes: 'oui',
    mustChangeNo: 'non',
    resetPassword: 'Réinitialiser le mot de passe',
    disable: 'Désactiver',
    enable: 'Activer',
    createDescription:
      'Le nouvel utilisateur devra changer ce mot de passe à la première connexion.',
    initialPassword: 'Mot de passe initial',
    resetPrompt: 'Nouveau mot de passe temporaire pour {email}.\n{requirements}',
  },
} as const;
