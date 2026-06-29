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
