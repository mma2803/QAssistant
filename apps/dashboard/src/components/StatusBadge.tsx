import type { TestType } from '@qassistant/shared';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { integrationStatusLabel } from '@/lib/format';

type Variant = React.ComponentProps<typeof Badge>['variant'];

/** Map a domain status string to a badge variant. */
const VARIANT_BY_STATUS: Record<string, Variant> = {
  // session / tenant / project / user lifecycle
  active: 'success',
  completed: 'secondary',
  inactive: 'outline',
  disabled: 'outline',
  // signup-link lifecycle
  expired: 'outline',
  revoked: 'destructive',
  // review status
  approved: 'success',
  draft: 'warning',
  superseded: 'outline',
  // integration status
  integrated: 'success',
  ready_to_integrate: 'warning',
  failed_to_integrate: 'destructive',
  not_ready: 'outline',
};

export function StatusBadge({ status }: { status: string }): JSX.Element {
  const { t } = useI18n();
  const translated = t(`status.${status}`);
  const label = translated === `status.${status}` ? status : translated;
  return <Badge variant={VARIANT_BY_STATUS[status] ?? 'secondary'}>{label}</Badge>;
}

/** Integration status with a localized human label (falls back to format.ts). */
export function IntegrationBadge({ status }: { status: string }): JSX.Element {
  const { t } = useI18n();
  const key = `ui.integration_${status}`;
  const translated = t(key);
  const label = translated === key ? integrationStatusLabel(status) : translated;
  return <Badge variant={VARIANT_BY_STATUS[status] ?? 'secondary'}>{label}</Badge>;
}

/** UI vs back-end test type, in distinct colors. */
export function TestTypeBadge({ type }: { type: TestType }): JSX.Element {
  const { t } = useI18n();
  const isBackend = type === 'backend';
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-md border border-transparent px-2 py-0.5 text-xs font-medium',
        isBackend
          ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
          : 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
      )}
    >
      {isBackend ? t('ui.testBackend') : t('ui.testUi')}
    </span>
  );
}

/**
 * Subtle full-row tint keyed off the session's derived integration status, so a
 * scan of the records list surfaces what shipped (green), what failed (red), and
 * what is queued to integrate (amber). Readable in light and dark; the selected
 * state still wins via the table's data-[state=selected] style.
 */
export function integrationRowClass(status: string | null): string {
  switch (status) {
    case 'integrated':
      return 'bg-success/10 hover:bg-success/15';
    case 'failed_to_integrate':
      return 'bg-destructive/10 hover:bg-destructive/15';
    case 'ready_to_integrate':
      return 'bg-warning/10 hover:bg-warning/15';
    default:
      return '';
  }
}
