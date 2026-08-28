import { statfsSync } from "node:fs";

export const DISK_FREE_PERCENT_THRESHOLD = 10;
export const DISK_FREE_FLOOR_BYTES = 2 * 1024 ** 3;

export interface DiskHealth {
  freeBytes: number;
  freeGiB: number;
  thresholdBytes: number;
  thresholdGiB: number;
  status: "ok" | "low";
}

export function diskHealthFromBytes(freeBytes: number, totalBytes: number): DiskHealth {
  const thresholdBytes = Math.max(DISK_FREE_FLOOR_BYTES, totalBytes * DISK_FREE_PERCENT_THRESHOLD / 100);
  return {
    freeBytes,
    freeGiB: Math.round((freeBytes / 1024 ** 3) * 10) / 10,
    thresholdBytes,
    thresholdGiB: Math.round((thresholdBytes / 1024 ** 3) * 10) / 10,
    status: freeBytes < thresholdBytes ? "low" : "ok",
  };
}

export function getRootDiskHealth(): DiskHealth {
  const stats = statfsSync("/");
  return diskHealthFromBytes(stats.bavail * stats.bsize, stats.blocks * stats.bsize);
}
