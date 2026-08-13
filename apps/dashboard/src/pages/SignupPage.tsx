import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { passwordSchema } from '@qassistant/shared';

import { ApiError, publicApi } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { LanguageToggle } from '@/components/LanguageToggle';
import { BugMark } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Public tenant self-signup via a super-admin-issued reusable link (change:
 * tenant-signup-links). Reached signed-out at /signup/:token, outside the
 * authenticated route table (App.tsx). The token is validated on mount so an
 * expired/revoked/unknown link shows a clear message instead of a dead form;
 * a valid link renders the tenant-name + first-admin form and redeems it.
 */
export function SignupPage(): JSX.Element {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; slug: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await publicApi.validateInvitation(token);
        if (cancelled) return;
        setValid(res.valid);
        setExpiresAt(res.expiresAt);
      } catch {
        if (!cancelled) setValid(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await publicApi.redeemInvitation({
        token,
        name,
        firstAdmin: { email: adminEmail, password: adminPassword },
      });
      setCreated({ name: res.tenant.name, slug: res.tenant.slug });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        setError(t('signup.duplicateName'));
      } else if (err instanceof ApiError && err.status === 403) {
        // The link was revoked or expired between the initial check and submit.
        setValid(false);
      } else {
        setError(err instanceof Error ? err.message : t('signup.failed'));
      }
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

        {checking ? (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              {t('signup.checking')}
            </CardContent>
          </Card>
        ) : created ? (
          <Card>
            <CardHeader>
              <h1 className="text-xl leading-none font-semibold">{t('signup.allSet')}</h1>
              <CardDescription>
                {t('signup.tenantCreated', { name: created.name })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">{t('signup.signInHint', { slug: created.slug })}</p>
              <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
                {t('signup.goToSignIn')}
              </Button>
            </CardContent>
          </Card>
        ) : !valid ? (
          <Card>
            <CardHeader>
              <h1 className="text-xl leading-none font-semibold">{t('signup.unavailableTitle')}</h1>
              <CardDescription>{t('signup.unavailableDesc')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <h1 className="text-xl leading-none font-semibold">{t('signup.title')}</h1>
              <CardDescription>
                {t('signup.description')}
                {expiresAt && (
                  <> {t('signup.validUntil', { date: formatDateTime(expiresAt) })}</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="t-name">{t('signup.tenantName')}</Label>
                  <Input
                    id="t-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-email">{t('signup.adminEmail')}</Label>
                  <Input
                    id="t-email"
                    type="email"
                    value={adminEmail}
                    autoComplete="username"
                    onChange={(e) => setAdminEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-pw">{t('signup.adminPassword')}</Label>
                  <Input
                    id="t-pw"
                    type="password"
                    value={adminPassword}
                    autoComplete="new-password"
                    onChange={(e) => setAdminPassword(e.target.value)}
                    required
                  />
                  <p className="text-muted-foreground text-xs">{t('password.requirements')}</p>
                </div>
                {error && <p className="text-destructive text-sm">{error}</p>}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    busy ||
                    !name.trim() ||
                    !adminEmail ||
                    !passwordSchema.safeParse(adminPassword).success
                  }
                >
                  {busy ? t('signup.submitting') : t('signup.submit')}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
