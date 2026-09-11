export type HistorySelection<T> =
  | { kind: "selected"; commit: T }
  | { kind: "cleared" }
  | { kind: "pending" };

export function resolveHistorySelection<T extends { hash: string }>(commits: T[], selectedHash: string | null | undefined): HistorySelection<T> {
  if (selectedHash === null) return { kind: "cleared" };
  if (selectedHash === undefined) {
    const newest = commits[0];
    return newest === undefined ? { kind: "pending" } : { kind: "selected", commit: newest };
  }
  const commit = commits.find(candidate => candidate.hash.startsWith(selectedHash));
  return commit === undefined ? { kind: "pending" } : { kind: "selected", commit };
}

export function historySelectionMissing(input: {
  selection: HistorySelection<unknown>;
  selectedHash: string | null | undefined;
  loading: boolean;
  hasNextPage: boolean;
}): boolean {
  return input.selection.kind === "pending" && typeof input.selectedHash === "string"
    && !input.loading && !input.hasNextPage;
}
