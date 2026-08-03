import { useEffect, useRef, useState } from 'react';
// rrweb's own replay stylesheet (cursor + iframe reset). Required for the replay
// to render correctly.
import 'rrweb/dist/style.css';

/**
 * rrweb DOM-replay player (spec 5.2 "rrweb-player replay of DOM-replay").
 *
 * Drives rrweb's own `Replayer` directly with a minimal custom control bar,
 * instead of the `rrweb-player` wrapper: rrweb-player 2.x ships without its
 * replay engine bundled (it depends on @rrweb/replay), so the wrapper mounted an
 * empty shell — no iframe, no controller, a blank frozen frame (BUG-009). The
 * `rrweb` package contains the Replayer, so it bundles and renders reliably.
 *
 * Events are fetched server-side and passed in via the `events` prop: the caller
 * loads them from GET /dashboard/sessions/{id}/replay, which decodes and
 * concatenates the session's dom_chunk artifacts (the capture upload credential
 * stays write-only, contract section 7; the read is a role-scoped server read).
 * When no events are available (no chunks captured, or the bytes are not
 * reachable) it renders a clear placeholder and points the user at the export.
 */

interface Replayer {
  play: (timeOffset?: number) => void;
  pause: (timeOffset?: number) => void;
  getCurrentTime: () => number;
  getMetaData: () => { totalTime: number };
  setConfig: (c: { speed: number }) => void;
  wrapper: HTMLElement;
  destroy?: () => void;
}

const SPEEDS = [1, 2, 4, 8];

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ReplayPlayer({ events }: { events?: unknown[] }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!events || events.length === 0 || !stageRef.current) return;
    let destroyed = false;
    let replayer: Replayer | null = null;

    // The recorded viewport changes across pages (e.g. 939→1174), so recompute
    // the scale from the LIVE iframe size on every frame — otherwise the replayed
    // page is scaled with a stale ratio and looks misplaced/overlapping.
    const rescale = (): void => {
      const host = hostRef.current;
      const wrapper = replayer?.wrapper;
      if (!host || !wrapper) return;
      const iframe = wrapper.querySelector('iframe');
      const recW = iframe ? Number(iframe.getAttribute('width')) : 0;
      const recH = iframe ? Number(iframe.getAttribute('height')) : 0;
      if (!recW || !recH) return;
      const scale = host.clientWidth / recW;
      wrapper.style.transformOrigin = 'top left';
      wrapper.style.transform = `scale(${scale})`;
      if (stageRef.current) stageRef.current.style.height = `${Math.round(recH * scale)}px`;
    };

    // Single rAF loop: keeps the scale correct on any viewport/host change and,
    // while playing, drives the clock from getCurrentTime() (rrweb 2.x has no
    // current-time event). Stops playback at the end.
    const tick = (): void => {
      if (destroyed) return;
      rescale();
      if (playingRef.current && replayer) {
        const t = replayer.getCurrentTime();
        const tot = replayer.getMetaData().totalTime;
        if (t >= tot) {
          playingRef.current = false;
          setPlaying(false);
          setCurrent(tot);
        } else {
          setCurrent(t);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    void import('rrweb')
      .then(({ Replayer: ReplayerCtor }) => {
        if (destroyed || !stageRef.current) return;
        const ordered = [...(events as { timestamp?: number }[])].sort(
          (a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0),
        );
        stageRef.current.innerHTML = '';
        replayer = new ReplayerCtor(ordered as ConstructorParameters<typeof ReplayerCtor>[0], {
          root: stageRef.current,
          skipInactive: false,
          showWarning: false,
          mouseTail: false,
        }) as unknown as Replayer;
        replayerRef.current = replayer;
        setTotal(replayer.getMetaData().totalTime);
        replayer.pause(0); // paint the first frame; playback starts on the user's click
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load replay player');
      });

    return () => {
      destroyed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        replayer?.pause();
        replayer?.destroy?.();
      } catch {
        /* ignore teardown races */
      }
      replayerRef.current = null;
      if (stageRef.current) stageRef.current.innerHTML = '';
    };
  }, [events]);

  function toggle(): void {
    const r = replayerRef.current;
    if (!r) return;
    if (playingRef.current) {
      r.pause();
      playingRef.current = false;
      setPlaying(false);
    } else {
      r.play(current >= total ? 0 : current);
      playingRef.current = true;
      setPlaying(true);
    }
  }

  function seek(ms: number): void {
    const r = replayerRef.current;
    if (!r) return;
    setCurrent(ms);
    if (playingRef.current) r.play(ms);
    else r.pause(ms);
  }

  function changeSpeed(s: number): void {
    const r = replayerRef.current;
    setSpeed(s);
    if (!r) return;
    r.setConfig({ speed: s });
    if (playingRef.current) r.play(r.getCurrentTime()); // re-arm the timer at the new speed
  }

  function fullscreen(): void {
    void hostRef.current?.requestFullscreen?.();
  }

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

  return (
    <div className="replay-host" ref={hostRef} style={{ background: '#fff' }}>
      <div ref={stageRef} style={{ overflow: 'hidden', background: '#fff' }} />
      <div
        className="row"
        style={{ alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '1px solid var(--border)' }}
      >
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} style={{ minWidth: 40 }}>
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={total || 0}
          step={100}
          value={Math.min(current, total || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ flex: 1 }}
          aria-label="Seek"
        />
        <span className="muted" style={{ fontSize: 12, minWidth: 84, textAlign: 'right' }}>
          {fmt(current)} / {fmt(total)}
        </span>
        <div className="row" style={{ gap: 4 }}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => changeSpeed(s)}
              aria-pressed={speed === s}
              style={{
                minWidth: 34,
                fontWeight: speed === s ? 700 : 400,
                opacity: speed === s ? 1 : 0.6,
              }}
            >
              {s}×
            </button>
          ))}
        </div>
        <button onClick={fullscreen} aria-label="Fullscreen" title="Fullscreen">
          ⛶
        </button>
      </div>
    </div>
  );
}
