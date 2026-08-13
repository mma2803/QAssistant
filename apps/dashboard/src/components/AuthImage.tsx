import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * Renders a tenant-private artifact image (a capture screenshot) inline.
 *
 * Screenshots live behind an authenticated, role-scoped read endpoint, so a
 * plain <img src> (which cannot send the bearer token) does not work. This
 * component fetches the bytes over the API client, wraps them in an object URL,
 * and revokes the URL on unmount/refetch so blobs do not leak.
 *
 * When `zoomable` is set, clicking the thumbnail opens a full-size lightbox that
 * reuses the already-loaded blob URL (never the API URL, which 401s on a direct
 * navigation because the browser cannot attach the bearer token — see BUG-003).
 */
export function AuthImage({
  sessionId,
  artifactId,
  alt,
  className,
  zoomable = false,
}: {
  sessionId: string;
  artifactId: string;
  alt: string;
  className?: string;
  zoomable?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api
      .artifactUrl(sessionId, artifactId)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [sessionId, artifactId]);

  if (error) {
    return (
      <div className="text-muted-foreground grid aspect-video place-items-center rounded-md border text-xs">
        {t('ui.imageUnavailable')}
      </div>
    );
  }
  if (!url) {
    return (
      <div className="bg-muted/50 grid aspect-video animate-pulse place-items-center rounded-md border text-xs">
        {t('ui.imageLoading')}
      </div>
    );
  }

  const img = (
    <img
      alt={alt}
      src={url}
      className={cn('w-full rounded-md border', zoomable && 'cursor-zoom-in', className)}
      onClick={zoomable ? () => setOpen(true) : undefined}
    />
  );

  if (!zoomable) return img;

  return (
    <>
      {img}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[92vw] p-2 sm:max-w-5xl">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img alt={alt} src={url} className="max-h-[85vh] w-full rounded object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
