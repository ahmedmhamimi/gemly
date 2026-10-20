/** Small pure helpers for the Backup dialog. */

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** First `max` failed titles + a "+N more" tail. @returns {{ lines: string[], more: number }} */
export function describeFailures(failures, max = 8) {
  return { lines: failures.slice(0, max).map((f) => f.title || f.id), more: Math.max(0, failures.length - max) };
}

/** Largest backup file the restore dialog will read into memory. */
export const MAX_RESTORE_BYTES = 300 * 1024 * 1024;

/** Keep a user-chosen title usable as a file name and heading. */
export const cleanTitle = (s, fallback) => (String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 150) || fallback);
