import { useState, type FormEvent } from 'react';

import { useAuth } from '@/auth/AuthContext';
import { BugMark } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Self-hosted email/password sign-in (spec 5.1). The tenant field selects
 * which tenant to sign into by its slug; leaving it blank signs in as the
 * super-admin. On success the AuthProvider bootstraps /auth/me and the router
 * routes by role (or to the forced password-change screen if the marker is set).
 */
export function LoginPage(): JSX.Element {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password, tenantSlug || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BugMark className="size-12" />
          <span className="text-lg font-semibold tracking-tight">
            <span className="text-[#4F46E5] dark:text-[#818CF8]">Q</span>Assistant
          </span>
        </div>
        <Card>
          <CardHeader>
            <h1 className="text-xl leading-none font-semibold">Sign in</h1>
            <CardDescription>Access your tenant's QA workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant">Tenant</Label>
                <Input
                  id="tenant"
                  type="text"
                  value={tenantSlug}
                  placeholder="tenant slug (blank for super-admin)"
                  onChange={(e) => setTenantSlug(e.target.value)}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
