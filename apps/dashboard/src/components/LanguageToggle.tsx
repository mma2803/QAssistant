import { Languages } from 'lucide-react';

import { useI18n, type Lang } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Manual language selector (FR/EN). The initial language auto-detects from the
 * browser; picking one here persists an override (see i18n/index.tsx).
 */
export function LanguageToggle(): JSX.Element {
  const { lang, setLang, t } = useI18n();
  const options: Lang[] = ['en', 'fr'];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('lang.label')} title={t('lang.label')}>
          <Languages className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt}
            onSelect={() => setLang(opt)}
            className={opt === lang ? 'font-medium' : undefined}
          >
            {t(`lang.${opt}`)}
            {opt === lang ? ' ✓' : ''}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
