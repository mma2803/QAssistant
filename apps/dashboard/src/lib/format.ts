/** Format raw wall-clock seconds as a compact h/m/s string. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '-';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"). */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** Human label for a generated test's integration status. */
export function integrationStatusLabel(status: string): string {
  switch (status) {
    case 'ready_to_integrate':
      return 'Ready to integrate';
    case 'integrated':
      return 'Integrated';
    case 'failed_to_integrate':
      return 'Failed';
    case 'not_ready':
      return 'Not ready';
    default:
      return status;
  }
}
