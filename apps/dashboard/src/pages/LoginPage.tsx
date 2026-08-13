import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';
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
 *
 * On success we explicitly navigate to the landing target instead of leaving
 * the URL untouched: the login screen renders outside <Routes>, so without this
 * the address bar keeps whatever path it held (e.g. a browser-restored
 * `/sessions` after a token expiry) and the user lands there instead of the
 * role's default view. We honour an intended `state.from` if a guard supplied
 * one, otherwise fall back to `/`, which redirects per role (Overview for
 * admin/qa-engineer, Tenants for super-admin).
 */
export function LoginPage(): JSX.Element {
  const { signIn } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from?.pathname;
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
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageToggle />
      </div>
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BugMark className="size-12" />
          <span className="text-lg font-semibold tracking-tight">
            <span className="text-[#4F46E5] dark:text-[#818CF8]">Q</span>Assistant
          </span>
        </div>
        <Card>
          <CardHeader>
            <h1 className="text-xl leading-none font-semibold">{t('login.title')}</h1>
            <CardDescription>{t('login.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">{t('login.email')}</Label>
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
                <Label htmlFor="password">{t('login.password')}</Label>
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
                <Label htmlFor="tenant">{t('login.tenant')}</Label>
                <Input
                  id="tenant"
                  type="text"
                  value={tenantSlug}
                  placeholder={t('login.tenantPlaceholder')}
                  onChange={(e) => setTenantSlug(e.target.value)}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t('login.submitting') : t('login.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
