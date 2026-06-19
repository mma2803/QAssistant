import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';

/**
 * Forced password-change screen (spec 5.1). Shown when the verified token
 * carries mustChangePassword. The user cannot reach any other view until they
 * set a new password; completePasswordChange sets it in Identity Platform, calls
 * the backend's allowlisted /auth/complete-password-change to clear the marker,
 * refreshes the token, and re-bootstraps.
 */
export function PasswordChangePage(): JSX.Element {
  const { completePasswordChange, signOut } = useAuth();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (pw1.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (pw1 !== pw2) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await completePasswordChange(pw1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card auth-card col" onSubmit={onSubmit}>
        <h2 style={{ margin: 0 }}>Set a new password</h2>
        <div className="notice">
          Your account requires a password change before you can continue.
        </div>
        <label className="col" style={{ gap: 4 }}>
          <span className="muted">New password</span>
          <input
            type="password"
            value={pw1}
            autoComplete="new-password"
            onChange={(e) => setPw1(e.target.value)}
            required
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="muted">Confirm password</span>
          <input
            type="password"
            value={pw2}
            autoComplete="new-password"
            onChange={(e) => setPw2(e.target.value)}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save password'}
          </button>
          <button type="button" onClick={() => void signOut()}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
