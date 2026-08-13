import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { passwordSchema } from '@qassistant/shared';

import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Forced password-change screen (spec 5.1). Shown when the verified token
 * carries mustChangePassword. The user cannot reach any other view until they
 * set a new password; completePasswordChange sets it in Identity Platform, calls
 * the backend's allowlisted /auth/complete-password-change to clear the marker,
 * refreshes the token, and re-bootstraps.
 */
export function PasswordChangePage(): JSX.Element {
  const { completePasswordChange, signOut } = useAuth();
  const { t } = useI18n();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!passwordSchema.safeParse(pw1).success) {
      setError(t('password.requirements'));
      return;
    }
    if (pw1 !== pw2) {
      setError(t('password.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await completePasswordChange(pw1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('passwordChange.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="bg-primary/10 text-primary mb-1 flex size-10 items-center justify-center rounded-lg">
            <KeyRound className="size-5" />
          </div>
          <h1 className="text-xl leading-none font-semibold">{t('passwordChange.title')}</h1>
          <CardDescription>{t('passwordChange.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="pw1">{t('password.newPassword')}</Label>
              <Input
                id="pw1"
                type="password"
                value={pw1}
                autoComplete="new-password"
                onChange={(e) => setPw1(e.target.value)}
                required
              />
              <p className="text-muted-foreground text-xs">{t('password.requirements')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">{t('password.confirmPassword')}</Label>
              <Input
                id="pw2"
                type="password"
                value={pw2}
                autoComplete="new-password"
                onChange={(e) => setPw2(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy} className="flex-1">
                {busy ? t('passwordChange.saving') : t('passwordChange.save')}
              </Button>
              <Button type="button" variant="outline" onClick={() => void signOut()}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
