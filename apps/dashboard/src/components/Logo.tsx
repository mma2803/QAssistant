import { cn } from '@/lib/utils';

const BODY = 'fill-[#4F46E5] dark:fill-[#818CF8]';
const LEGS = 'stroke-[#4F46E5] dark:stroke-[#818CF8]';
const DETAIL_FILL = 'fill-white dark:fill-[#0B1220]';
const DETAIL_STROKE = 'stroke-white dark:stroke-[#0B1220]';

/**
 * QAssistant brand mark: the stylized ladybug from the marketing site
 * (assets/logo.svg). Indigo on light, lighter indigo on dark; spots invert.
 */
export function BugMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="-2 -4 29 29"
      fill="none"
      role="img"
      aria-label="QAssistant"
      className={cn('shrink-0', className)}
    >
      <g className={LEGS} strokeWidth={1.8} strokeLinecap="round">
        <line x1="5" y1="8" x2="0.5" y2="5" />
        <line x1="3.5" y1="12" x2="-1" y2="12" />
        <line x1="5" y1="16" x2="0.5" y2="19" />
        <line x1="19" y1="8" x2="23.5" y2="5" />
        <line x1="20.5" y1="12" x2="25" y2="12" />
        <line x1="19" y1="16" x2="23.5" y2="19" />
        <line x1="9.5" y1="2" x2="6.5" y2="-2.5" />
        <line x1="14.5" y1="2" x2="17.5" y2="-2.5" />
      </g>
      <ellipse cx="12" cy="12" rx="10" ry="11" className={BODY} />
      <circle cx="12" cy="3.2" r="3.4" className={BODY} />
      <line x1="12" y1="3" x2="12" y2="22.5" strokeWidth={1.6} className={DETAIL_STROKE} />
      <circle cx="7.6" cy="10" r="1.7" className={DETAIL_FILL} />
      <circle cx="16.4" cy="10" r="1.7" className={DETAIL_FILL} />
      <circle cx="8.2" cy="16" r="1.7" className={DETAIL_FILL} />
      <circle cx="15.8" cy="16" r="1.7" className={DETAIL_FILL} />
    </svg>
  );
}

/** Bug mark + "QAssistant" wordmark (Q in brand indigo). */
export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <BugMark className="size-7" />
      <span className="text-base font-semibold tracking-tight">
        <span className="text-[#4F46E5] dark:text-[#818CF8]">Q</span>Assistant
      </span>
    </div>
  );
}
