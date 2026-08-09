import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTheme } from '@/components/theme-provider';

function Toaster({ ...props }: ToasterProps): JSX.Element {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
