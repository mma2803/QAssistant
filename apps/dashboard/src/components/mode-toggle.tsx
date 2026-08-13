import { MoonIcon, SunIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { useI18n } from '@/i18n';

/** A single button that flips between light and dark. */
export function ModeToggle(): JSX.Element {
  const { t } = useI18n();
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? t('ui.switchToLight') : t('ui.switchToDark')}
      title={isDark ? t('ui.lightMode') : t('ui.darkMode')}
    >
      {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  );
}
