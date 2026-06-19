import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Renders a tenant-private artifact image (a capture screenshot) inline.
 *
 * Screenshots live behind an authenticated, role-scoped read endpoint, so a
 * plain <img src> (which cannot send the bearer token) does not work. This
 * component fetches the bytes over the API client, wraps them in an object URL,
 * and revokes the URL on unmount/refetch so blobs do not leak.
 */
export function AuthImage({
  sessionId,
  artifactId,
  alt,
}: {
  sessionId: string;
  artifactId: string;
  alt: string;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
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
    return <div className="muted" style={{ fontSize: 12 }}>Unavailable</div>;
  }
  if (!url) {
    return <div className="muted" style={{ fontSize: 12 }}>Loading...</div>;
  }
  return <img alt={alt} src={url} />;
}
