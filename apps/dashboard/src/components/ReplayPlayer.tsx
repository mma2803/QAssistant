import { useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play } from 'lucide-react';
// rrweb's own replay stylesheet (cursor + iframe reset). Required for the replay
// to render correctly.
import 'rrweb/dist/style.css';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';

const HOST_CLASS = 'min-h-90 overflow-hidden rounded-lg border bg-white';

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
  const { t } = useI18n();
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
        setError(e instanceof Error ? e.message : t('ui.replayFailedToLoad'));
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
      <div className={cn(HOST_CLASS, 'grid place-items-center')}>
        <div className="text-muted-foreground p-4 text-center text-sm">
          <div className="text-foreground">{t('ui.replayCaptured')}</div>
          <div className="mt-1.5">{t('ui.replayUseExport')}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className={cn(HOST_CLASS, 'text-destructive p-4 text-sm')}>{error}</div>;
  }

  return (
    <div className={HOST_CLASS} ref={hostRef}>
      <div ref={stageRef} className="overflow-hidden bg-white" />
      <div className="bg-card flex items-center gap-3 border-t px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={playing ? t('ui.replayPause') : t('ui.replayPlay')}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <input
          type="range"
          min={0}
          max={total || 0}
          step={100}
          value={Math.min(current, total || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          className="accent-primary flex-1"
          aria-label={t('ui.replaySeek')}
        />
        <span className="text-muted-foreground min-w-20 text-right text-xs tabular-nums">
          {fmt(current)} / {fmt(total)}
        </span>
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <Button
              key={s}
              variant={speed === s ? 'default' : 'ghost'}
              size="sm"
              className="min-w-9 px-2"
              onClick={() => changeSpeed(s)}
              aria-pressed={speed === s}
            >
              {s}×
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={fullscreen}
          aria-label={t('ui.replayFullscreen')}
          title={t('ui.replayFullscreen')}
        >
          <Maximize2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
