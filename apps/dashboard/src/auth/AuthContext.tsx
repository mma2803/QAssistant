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
  signIn as fbSignIn,
  signOut as fbSignOut,
  reauthenticate as fbReauthenticate,
  getIdToken,
} from '../lib/firebase';

export type Role = 'admin' | 'qa-engineer';

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
  signIn: (email: string, password: string, tenantId?: string) => Promise<void>;
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
    const token = await getIdToken();
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
    // Re-bootstrap whenever the ID token changes (sign-in, refresh, sign-out).
    const unsub = onAuthChanged(() => {
      void bootstrap();
    });
    return unsub;
  }, []);

  const value = useMemo<AuthApi>(() => {
    const role = (state.me?.role === 'admin' || state.me?.role === 'qa-engineer'
      ? state.me.role
      : null) as Role | null;
    return {
      ...state,
      role,
      signIn: async (email, password, tenantId) => {
        await fbSignIn(email, password, tenantId);
        await bootstrap();
      },
      signOut: async () => {
        await fbSignOut();
        setState({ loading: false, me: null, mustChangePassword: false, signedIn: false });
      },
      completePasswordChange: async (newPassword) => {
        // The backend sets the new password (Admin SDK) AND clears the marker in
        // one call, using the still-valid current token. We must NOT call the
        // client-side updatePassword first: it would bump tokensValidAfterTime
        // and, since the guard verifies with checkRevoked=true, the token would
        // be rejected before it could clear the marker.
        await api.completePasswordChange(newPassword);
        // The password change bumped tokensValidAfterTime, so every token from
        // the current session (even refresh-token exchanges, which keep the old
        // auth_time) now fails checkRevoked. Re-sign-in with the new password to
        // mint a token with a current auth_time, then re-bootstrap.
        await fbReauthenticate(newPassword);
        await getIdToken(true);
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
