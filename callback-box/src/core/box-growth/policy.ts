import type {
  GrowthFinding,
  GrowthMeasurement,
  GrowthRateExpectation,
  GrowthRateFindingKind,
} from "./model.js";

type CountKind = "directories" | "files";
const MAX_RETAINED_SUBTREES = 20;

export const BOX_GROWTH_THRESHOLDS = {
  absoluteDirectories: 1_000,
  absoluteFiles: 10_000,
  rateDirectoriesPerHour: 10,
  rateFilesPerHour: 25,
  rateCommitsPerHour: 10,
  connectorRateDirectoriesPerHour: 5,
  connectorRateFilesPerHour: 10,
  acceptedGrowthMultiplier: 2,
  expectedRateHeadroomMultiplier: 1.5,
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

function rateThreshold(input: {
  kind: GrowthRateFindingKind;
  path?: string;
  initial: number;
  expectations: GrowthRateExpectation[];
}): number {
  const { kind, path, initial, expectations } = input;
  const expected = expectations.find(
    (item) => item.kind === kind && item.path === (path ?? null),
  );
  return Math.max(initial, expected?.thresholdPerHour ?? 0);
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
    .map((item) => {
      const retainedFloor = previous.largestSubtrees.length < MAX_RETAINED_SUBTREES
        ? 0
        : Math.min(...previous.largestSubtrees.map((previousItem) => previousItem[kind]));
      let missingBaseline = item[kind];
      if (item.source === "connector") missingBaseline = 0;
      else if (item[kind] > retainedFloor) missingBaseline = retainedFloor;
      return { path: item.path, delta: item[kind] - (previousByPath.get(item.path)?.[kind] ?? missingBaseline) };
    })
    .filter((item) => item.delta > 0)
    .toSorted((a, b) => b.delta - a.delta)
    .at(0)?.path;
}

export function evaluateBoxGrowth(input: {
  accepted: GrowthMeasurement;
  previous: GrowthMeasurement;
  current: GrowthMeasurement;
  acknowledgedAt?: string | null;
  rateExpectations?: GrowthRateExpectation[];
}): GrowthFinding[] {
  const { accepted, previous, current, acknowledgedAt } = input;
  const expectations = input.rateExpectations ?? [];
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
    intervalMs > BOX_GROWTH_THRESHOLDS.maximumRateIntervalMs ||
    previous.skippedDirectories > 0 ||
    current.skippedDirectories > 0
  ) {
    return findings;
  }
  const directoryRate = rate(current.counts.directories - previous.counts.directories, intervalMs);
  const fileRate = rate(current.counts.files - previous.counts.files, intervalMs);
  const directoryThreshold = rateThreshold({
    kind: "rate-directories",
    initial: BOX_GROWTH_THRESHOLDS.rateDirectoriesPerHour,
    expectations,
  });
  if (directoryRate >= directoryThreshold) {
    const subtreePath = fastestGrowingSubtreePath({ previous, current, kind: "directories" });
    findings.push({
      kind: "rate-directories",
      ...(subtreePath === undefined ? {} : { path: subtreePath }),
      actual: directoryRate,
      threshold: directoryThreshold,
    });
  }
  const fileThreshold = rateThreshold({
    kind: "rate-files",
    initial: BOX_GROWTH_THRESHOLDS.rateFilesPerHour,
    expectations,
  });
  if (fileRate >= fileThreshold) {
    const subtreePath = fastestGrowingSubtreePath({ previous, current, kind: "files" });
    findings.push({
      kind: "rate-files",
      ...(subtreePath === undefined ? {} : { path: subtreePath }),
      actual: fileRate,
      threshold: fileThreshold,
    });
  }
  if (previous.history.status === "available" && current.history.status === "available") {
    const commitRate = rate(current.history.commits - previous.history.commits, intervalMs);
    const commitThreshold = rateThreshold({
      kind: "rate-commits",
      initial: BOX_GROWTH_THRESHOLDS.rateCommitsPerHour,
      expectations,
    });
    if (commitRate >= commitThreshold) {
      findings.push({ kind: "rate-commits", actual: commitRate, threshold: commitThreshold });
    }
  }
  const previousByPath = new Map(previous.largestSubtrees.map((item) => [item.path, item]));
  for (const subtree of current.largestSubtrees.filter((item) => item.source === "connector")) {
    const prior = previousByPath.get(subtree.path);
    const subtreeDirectoryRate = rate(subtree.directories - (prior?.directories ?? 0), intervalMs);
    const subtreeFileRate = rate(subtree.files - (prior?.files ?? 0), intervalMs);
    const connectorDirectoryThreshold = rateThreshold({
      kind: "rate-connector-directories",
      path: subtree.path,
      initial: BOX_GROWTH_THRESHOLDS.connectorRateDirectoriesPerHour,
      expectations,
    });
    const connectorFileThreshold = rateThreshold({
      kind: "rate-connector-files",
      path: subtree.path,
      initial: BOX_GROWTH_THRESHOLDS.connectorRateFilesPerHour,
      expectations,
    });
    if (subtreeDirectoryRate >= connectorDirectoryThreshold) {
      findings.push({ kind: "rate-connector-directories", path: subtree.path, actual: subtreeDirectoryRate, threshold: connectorDirectoryThreshold });
    }
    if (subtreeFileRate >= connectorFileThreshold) {
      findings.push({ kind: "rate-connector-files", path: subtree.path, actual: subtreeFileRate, threshold: connectorFileThreshold });
    }
  }
  return findings;
}
