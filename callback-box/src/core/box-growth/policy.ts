import type { GrowthFinding, GrowthMeasurement } from "./model.js";

type CountKind = "directories" | "files";

export const BOX_GROWTH_THRESHOLDS = {
  absoluteDirectories: 10_000,
  absoluteFiles: 100_000,
  rateDirectoriesPerHour: 200,
  rateFilesPerHour: 200,
  rateCommitsPerHour: 100,
  connectorRateMultiplier: 0.5,
  acceptedGrowthMultiplier: 1.25,
  minimumRateIntervalMs: 30 * 60 * 1000,
  maximumRateIntervalMs: 2 * 60 * 60 * 1000,
} as const;

function rate(delta: number, intervalMs: number): number {
  return delta * (60 * 60 * 1000 / intervalMs);
}

function absoluteThreshold(input: {
  global: number;
  accepted: number;
  acknowledgedAt: string | null | undefined;
}): number {
  const { global, accepted, acknowledgedAt } = input;
  if (acknowledgedAt === null || acknowledgedAt === undefined) return global;
  return Math.max(global, Math.ceil(accepted * BOX_GROWTH_THRESHOLDS.acceptedGrowthMultiplier));
}

function largestSubtreePath(measurement: GrowthMeasurement, kind: CountKind): string | undefined {
  return measurement.largestSubtrees.toSorted((a, b) => b[kind] - a[kind]).at(0)?.path;
}

function fastestGrowingSubtreePath(
  input: { previous: GrowthMeasurement; current: GrowthMeasurement; kind: CountKind },
): string | undefined {
  const { previous, current, kind } = input;
  const previousByPath = new Map(previous.largestSubtrees.map((item) => [item.path, item]));
  return current.largestSubtrees
    .map((item) => ({ path: item.path, delta: item[kind] - (previousByPath.get(item.path)?.[kind] ?? item[kind]) }))
    .filter((item) => item.delta > 0)
    .toSorted((a, b) => b.delta - a.delta)
    .at(0)?.path;
}

export function evaluateBoxGrowth(input: {
  accepted: GrowthMeasurement;
  previous: GrowthMeasurement;
  current: GrowthMeasurement;
  acknowledgedAt?: string | null;
}): GrowthFinding[] {
  const { accepted, previous, current, acknowledgedAt } = input;
  const findings: GrowthFinding[] = [];
  const directoryLimit = absoluteThreshold({
    global: BOX_GROWTH_THRESHOLDS.absoluteDirectories,
    accepted: accepted.counts.directories,
    acknowledgedAt,
  });
  const fileLimit = absoluteThreshold({
    global: BOX_GROWTH_THRESHOLDS.absoluteFiles,
    accepted: accepted.counts.files,
    acknowledgedAt,
  });
  if (current.counts.directories > directoryLimit) {
    const subtreePath = largestSubtreePath(current, "directories");
    findings.push({
      kind: "absolute-directories",
      ...(subtreePath === undefined ? {} : { path: subtreePath }),
      actual: current.counts.directories,
      threshold: directoryLimit,
    });
  }
  if (current.counts.files > fileLimit) {
    const subtreePath = largestSubtreePath(current, "files");
    findings.push({
      kind: "absolute-files",
      ...(subtreePath === undefined ? {} : { path: subtreePath }),
      actual: current.counts.files,
      threshold: fileLimit,
    });
  }
  const intervalMs = Date.parse(current.measuredAt) - Date.parse(previous.measuredAt);
  if (
    intervalMs < BOX_GROWTH_THRESHOLDS.minimumRateIntervalMs ||
    intervalMs > BOX_GROWTH_THRESHOLDS.maximumRateIntervalMs
  ) {
    return findings;
  }
  const directoryRate = rate(current.counts.directories - previous.counts.directories, intervalMs);
  const fileRate = rate(current.counts.files - previous.counts.files, intervalMs);
  if (directoryRate >= BOX_GROWTH_THRESHOLDS.rateDirectoriesPerHour) {
    const subtreePath = fastestGrowingSubtreePath({ previous, current, kind: "directories" });
    findings.push({
      kind: "rate-directories",
      ...(subtreePath === undefined ? {} : { path: subtreePath }),
      actual: directoryRate,
      threshold: BOX_GROWTH_THRESHOLDS.rateDirectoriesPerHour,
    });
  }
  if (fileRate >= BOX_GROWTH_THRESHOLDS.rateFilesPerHour) {
    const subtreePath = fastestGrowingSubtreePath({ previous, current, kind: "files" });
    findings.push({
      kind: "rate-files",
      ...(subtreePath === undefined ? {} : { path: subtreePath }),
      actual: fileRate,
      threshold: BOX_GROWTH_THRESHOLDS.rateFilesPerHour,
    });
  }
  if (previous.history.status === "available" && current.history.status === "available") {
    const commitRate = rate(current.history.commits - previous.history.commits, intervalMs);
    if (commitRate >= BOX_GROWTH_THRESHOLDS.rateCommitsPerHour) {
      findings.push({ kind: "rate-commits", actual: commitRate, threshold: BOX_GROWTH_THRESHOLDS.rateCommitsPerHour });
    }
  }
  const previousByPath = new Map(previous.largestSubtrees.map((item) => [item.path, item]));
  for (const subtree of current.largestSubtrees.filter((item) => item.source === "connector")) {
    const prior = previousByPath.get(subtree.path);
    if (prior === undefined) continue;
    const subtreeDirectoryRate = rate(subtree.directories - prior.directories, intervalMs);
    const subtreeFileRate = rate(subtree.files - prior.files, intervalMs);
    const directoryThreshold = BOX_GROWTH_THRESHOLDS.rateDirectoriesPerHour * BOX_GROWTH_THRESHOLDS.connectorRateMultiplier;
    const fileThreshold = BOX_GROWTH_THRESHOLDS.rateFilesPerHour * BOX_GROWTH_THRESHOLDS.connectorRateMultiplier;
    if (subtreeDirectoryRate >= directoryThreshold) {
      findings.push({ kind: "rate-connector-directories", path: subtree.path, actual: subtreeDirectoryRate, threshold: directoryThreshold });
    }
    if (subtreeFileRate >= fileThreshold) {
      findings.push({ kind: "rate-connector-files", path: subtree.path, actual: subtreeFileRate, threshold: fileThreshold });
    }
  }
  return findings;
}
