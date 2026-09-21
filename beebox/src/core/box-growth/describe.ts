/** Boxholder-facing text for growth findings and failed samples. */

import type { GrowthFinding, GrowthMeasurement } from "./model.js";

function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function megabytes(bytes: number): string {
  return `${count(bytes / (1024 * 1024))} MB`;
}

export function describeFinding(finding: GrowthFinding): string {
  if (finding.kind === "rate-commits") {
    return `${count(finding.actual)} commits/hour (limit ${count(finding.threshold)})`;
  }
  if (finding.kind === "rate-content-bytes") {
    return `box content grew by ${megabytes(finding.actual)}/hour (limit ${megabytes(finding.threshold)})`;
  }
  if (finding.kind === "rate-engine-bytes") {
    return `.beebox (engine indexes, caches and logs) grew by ${megabytes(finding.actual)}/hour (limit ${megabytes(finding.threshold)})`;
  }
  const unit = finding.kind.endsWith("directories") ? "directories" : "files";
  const connector = finding.kind.startsWith("rate-connector");
  const scope = connector ? finding.path ?? "connector subtree" : "box";
  const detail = connector || finding.path === undefined ? "" : `; fastest subtree: ${finding.path}`;
  return `${scope} grew by ${count(finding.actual)} ${unit}/hour (limit ${count(finding.threshold)})${detail}`;
}

/**
 * Samples taken beside the file scan that failed on their own. A green result
 * must say what it did not check rather than imply it did. Not reported for an
 * incomplete scan, which skips both and says so itself.
 */
export function failedSamples(current: GrowthMeasurement, incomplete: boolean): { history: string | null; bytes: string | null } {
  if (incomplete) return { history: null, bytes: null };
  return {
    history: current.history.status === "unavailable" ? current.history.error : null,
    bytes: current.bytes.status === "unavailable" ? current.bytes.error : null,
  };
}

export function failedSampleParts(failed: { history: string | null; bytes: string | null }): string[] {
  return [
    ...(failed.history === null ? [] : [`history measurement failed: ${failed.history}`]),
    ...(failed.bytes === null ? [] : [`disk use measurement failed: ${failed.bytes}`]),
  ];
}
