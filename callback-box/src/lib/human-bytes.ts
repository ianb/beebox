/**
 * Compact human byte-size formatting (`112 MB`, `4.2 KB`, `936 B`).
 *
 * One definition shared by the bulk-upload batch card body, the `<upload>`
 * wrapper's `bytes` attribute, and anywhere else a terse size label is wanted.
 * Binary units (1024-based), one decimal below 10, rounded above.
 */

const UNITS = ["KB", "MB", "GB", "TB"] as const;

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded)} ${UNITS[i]}`;
}
