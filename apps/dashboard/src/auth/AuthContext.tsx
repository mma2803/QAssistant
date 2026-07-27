import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthMeResponse } from '@qassistant/shared';
import { api, ApiError } from '../lib/api';
import {
  onAuthChanged,
  signIn as clientSignIn,
  signOut as clientSignOut,
  getAccessToken,
  tryRestoreSession,
} from '../lib/auth-client';

export type Role = 'admin' | 'qa-engineer' | 'super-admin';

interface AuthState {
  loading: boolean;
  /** Resolved bootstrap from GET /auth/me (null until signed in + resolved). */
  me: AuthMeResponse | null;
  /** True when the backend requires a password change before anything else. */
  mustChangePassword: boolean;
  signedIn: boolean;
}

interface AuthApi extends AuthState {
  role: Role | null;
  signIn: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Set a new password and clear the forced-change marker, then re-bootstrap. */
  completePasswordChange: (newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({
    loading: true,
    me: null,
    mustChangePassword: false,
    signedIn: false,
  });

  async function bootstrap(): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
      setState({ loading: false, me: null, mustChangePassword: false, signedIn: false });
      return;
    }
    try {
      const me = await api.me();
      setState({
        loading: false,
        me,
        mustChangePassword: me.mustChangePassword,
        signedIn: true,
      });
    } catch (err) {
      // The must_change_password gate blocks every route except the two
      // allowlisted ones; /auth/me is allowlisted, so a thrown gate here means
      // the token simply has the marker. Reflect it so the UI routes to the
      // forced-change screen.
      if (err instanceof ApiError && err.isMustChangePassword) {
        setState({ loading: false, me: null, mustChangePassword: true, signedIn: true });
        return;
      }
      // Any other failure: treat as signed out so the user can retry.
      setState({ loading: false, me: null, mustChangePassword: false, signedIn: false });
    }
  }

  useEffect(() => {
    // A refresh cookie may already be present on a fresh page load even
    // though nothing is held in memory yet; try to restore it once, then
    // re-bootstrap on every subsequent auth transition (sign-in/out/refresh).
    void tryRestoreSession().then(() => bootstrap());
    const unsub = onAuthChanged(() => {
      void bootstrap();
    });
    return unsub;
  }, []);

  const value = useMemo<AuthApi>(() => {
    const role = (state.me?.role === 'admin' ||
    state.me?.role === 'qa-engineer' ||
    state.me?.role === 'super-admin'
      ? state.me.role
      : null) as Role | null;
    return {
      ...state,
      role,
      signIn: async (email, password, tenantSlug) => {
        await clientSignIn(email, password, tenantSlug);
        await bootstrap();
      },
      signOut: async () => {
        await clientSignOut();
        setState({ loading: false, me: null, mustChangePassword: false, signedIn: false });
      },
      completePasswordChange: async (newPassword) => {
        // Unlike an admin-driven reset, completing a self-service password
        // change does not revoke the current session (see
        // IdentityService.setTenantUserPassword) — the current access token
        // keeps working, so no re-sign-in is needed, just re-bootstrap.
        await api.completePasswordChange(newPassword);
        await bootstrap();
      },
      refresh: bootstrap,
    };
  }, [state]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
