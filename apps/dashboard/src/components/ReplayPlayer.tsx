import { useEffect, useRef, useState } from 'react';

/**
 * rrweb DOM-replay player (spec 5.2 "rrweb-player replay of DOM-replay").
 *
 * Events are fetched server-side and passed in via the `events` prop: the
 * caller loads them from GET /dashboard/sessions/{id}/replay, which decodes and
 * concatenates the session's dom_chunk artifacts (the capture upload credential
 * stays write-only, contract section 7; the read is a role-scoped server read).
 * When no events are available (no chunks captured, or the bytes are not
 * reachable) it renders a clear placeholder and points the user at the export.
 */
export function ReplayPlayer({ events }: { events?: unknown[] }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!events || events.length === 0 || !hostRef.current) return;
    let destroyed = false;
    let player: { $destroy?: () => void } | null = null;

    // Load rrweb-player lazily so the (alpha) dependency does not bloat the
    // initial bundle and a missing build dep degrades gracefully.
    void import('rrweb-player')
      .then((mod) => {
        if (destroyed || !hostRef.current) return;
        const Player = mod.default;
        const width = hostRef.current.clientWidth || 960;
        player = new Player({
          target: hostRef.current,
          props: {
            events,
            width,
            height: Math.round((width * 9) / 16),
            autoPlay: false,
            showController: true,
          },
        });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load replay player');
      });

    return () => {
      destroyed = true;
      player?.$destroy?.();
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [events]);

  if (!events || events.length === 0) {
    return (
      <div className="replay-host" style={{ display: 'grid', placeItems: 'center', color: '#666' }}>
        <div style={{ textAlign: 'center', padding: 16 }}>
          <div>DOM-replay is captured for this recording.</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Use Export to download the replayable DOM chunks and screenshots.
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="replay-host error" style={{ padding: 16 }}>{error}</div>;
  }

  return <div className="replay-host" ref={hostRef} />;
}
