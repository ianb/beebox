/**
 * Human-readable byte sizes: `1536` → `"1.5 KB"`, `2_400_000` → `"2.3 MB"`.
 *
 * Scales through B/KB/MB/GB/TB, one decimal below 10 in a unit (and never for
 * bytes). Used wherever a file's size is shown (binary + JSON file renderers).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
