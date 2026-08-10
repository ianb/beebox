import { useCallback, useEffect, useMemo, useState } from "react";
import type { RendererProps } from "../renderers";
import { cbSource } from "../lib/source-tag";
import { requestTabArrangement, type ArrangementRelayResult } from "../lib/tab-arrangement-relay";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { CheckboxField } from "./ui/fields";
import { Stack } from "./ui/Stack";
import { Text } from "./ui/Text";

interface CapturedTab {
  id: string;
  title: string;
  url: string;
  pinned: boolean;
}

interface ArrangementData {
  transferId: string;
  status: "draft" | "ready";
  source: { windows: Array<{ id: string; tabs: CapturedTab[] }> };
  proposal: { windows: Array<{ id: string; tabs: string[] }>; close: string[] };
}

export function TabArrangementView({ data }: RendererProps) {
  const arrangement = useMemo(() => parseArrangement(data.frontmatter), [data.frontmatter]);
  if (arrangement === null) {
    return <Text as="div" tone="danger" className="p-4">This tab arrangement card is malformed. Open Source to repair it.</Text>;
  }
  return (
    <TabArrangementEditor
      key={`${arrangement.transferId}:${JSON.stringify(arrangement.proposal)}`}
      arrangement={arrangement}
      path={data.path}
    />
  );
}

function TabArrangementEditor({ arrangement, path }: { arrangement: ArrangementData; path: string }) {
  const [proposal, setProposal] = useState(() => normalizeProposal(arrangement));
  const [relay, setRelay] = useState<ArrangementRelayResult | null>(null);

  useEffect(() => {
    void requestTabArrangement({ action: "status", transferId: arrangement.transferId }).then(setRelay);
  }, [arrangement.transferId]);

  const apply = useCallback(async () => {
    setRelay(await requestTabArrangement({
      action: "apply",
      transferId: arrangement.transferId,
      proposal,
    }));
  }, [arrangement.transferId, proposal]);

  const undo = useCallback(async () => {
    setRelay(await requestTabArrangement({ action: "undo", transferId: arrangement.transferId }));
  }, [arrangement.transferId]);

  const toggleDeleted = useCallback((id: string, deleted: boolean) => {
    setProposal((current) => {
      const close = new Set(current.close);
      if (deleted) close.add(id);
      else close.delete(id);
      return {
        ...current,
        close: current.windows.flatMap((window) => window.tabs).filter((tabId) => close.has(tabId)),
      };
    });
  }, []);

  const tabs = new Map(arrangement.source.windows.flatMap((window) => window.tabs).map((tab) => [tab.id, tab]));
  const deleted = new Set(proposal.close);
  const remainingCount = tabs.size - deleted.size;
  const canApply = arrangement.status === "ready" && relay?.ok === true && relay.state === "ready";

  return (
    <div className="mx-auto max-w-4xl p-4" {...cbSource("card", path)}>
      <Stack gap="lg">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Text as="h1" size="lg" weight="semibold">Tab arrangement</Text>
            <Badge tone={arrangement.status === "ready" ? "success" : "warning"}>{arrangement.status}</Badge>
          </div>
          <Text as="p" size="sm" tone="subtle" className="mt-1">
            Check or uncheck tabs to mark them for deletion. Deleted tabs stay in place here for review; Clerk validates the live tabs again before changing anything.
          </Text>
          <Text as="p" size="xs" tone="subtle" className="mt-1">
            Checkbox changes affect this Apply only; they do not rewrite the saved card.
          </Text>
        </header>

        <Stack gap="md">
          {proposal.windows.map((window, index) => (
            <Card key={window.id} as="section" aria-label={`Proposed window ${index + 1}`} background="warm">
              <Text as="h2" weight="semibold" className="mb-2">Window {index + 1}</Text>
              <ol className="space-y-2">
                {window.tabs.map((id) => (
                  <TabRow
                    key={id}
                    tab={tabs.get(id)}
                    deleted={deleted.has(id)}
                    deletionDisabled={!deleted.has(id) && remainingCount === 1}
                    onDeletedChange={(checked) => toggleDeleted(id, checked)}
                  />
                ))}
              </ol>
            </Card>
          ))}
        </Stack>

        <ArrangementActions
          relay={relay}
          status={arrangement.status}
          canApply={canApply}
          onApply={apply}
          onUndo={undo}
        />
      </Stack>
    </div>
  );
}

function ArrangementActions(props: {
  relay: ArrangementRelayResult | null;
  status: "draft" | "ready";
  canApply: boolean;
  onApply: () => Promise<void>;
  onUndo: () => Promise<void>;
}) {
  const { relay, status, canApply, onApply, onUndo } = props;
  return (
    <Card background="info" border="subtle">
      <Stack gap="sm">
        {relay === null ? (
          <Text as="p" size="sm" tone="subtle">Checking for Callback Clerk…</Text>
        ) : (
          <Text as="p" size="sm" tone={relay.ok ? "default" : "danger"}>{relay.message}</Text>
        )}
        {status !== "ready" ? (
          <Text as="p" size="sm" tone="subtle">Set the card’s status to ready when the proposal is agreed.</Text>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button intent="primary" disabled={!canApply} onClick={onApply} loadingLabel="Applying…">Apply in Chrome</Button>
          {relay?.undoAvailable === true ? (
            <Button intent="secondary" onClick={onUndo} loadingLabel="Undoing…">Best-effort undo</Button>
          ) : null}
        </div>
      </Stack>
    </Card>
  );
}

function TabRow(props: {
  tab: CapturedTab | undefined;
  deleted: boolean;
  deletionDisabled: boolean;
  onDeletedChange: (deleted: boolean) => void;
}) {
  const { tab, deleted, deletionDisabled, onDeletedChange } = props;
  if (tab === undefined) return <li className="text-sm text-danger">Unknown tab UUID</li>;
  return (
    <li className={`min-w-0 rounded border px-3 py-2 ${deleted ? "border-danger/30 bg-danger/5" : "border-warm-200 bg-white"}`}>
      <CheckboxField
        checked={deleted}
        disabled={deletionDisabled}
        onChange={onDeletedChange}
        aria-label={`Delete ${tab.title}`}
        title={deletionDisabled ? "At least one tab must remain open" : undefined}
        label={(
          <div className={`min-w-0 ${deleted ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2">
              {tab.pinned ? <Badge size="sm" tone="info">Pinned</Badge> : null}
              {deleted ? <Badge size="sm" tone="danger">Deleted</Badge> : null}
              <div className="min-w-0">
                <Text as="div" size="sm" weight="medium" className={`truncate ${deleted ? "line-through" : ""}`}>{tab.title}</Text>
                <Text as="div" size="xs" tone="subtle" className="truncate">{tab.url}</Text>
              </div>
            </div>
          </div>
        )}
      />
    </li>
  );
}

function normalizeProposal(arrangement: ArrangementData): ArrangementData["proposal"] {
  const arranged = new Set(arrangement.proposal.windows.flatMap((window) => window.tabs));
  const sourceIds = arrangement.source.windows.flatMap((window) => window.tabs.map((tab) => tab.id));
  if (sourceIds.every((id) => arranged.has(id))) return arrangement.proposal;

  const windows = arrangement.proposal.windows.map((window) => ({ ...window, tabs: [...window.tabs] }));
  const survivorIds = new Set(windows.flatMap((window) => window.tabs));
  const deleted = new Set(arrangement.proposal.close);
  for (const sourceWindow of arrangement.source.windows) {
    const ids = sourceWindow.tabs.map((tab) => tab.id);
    for (const id of ids) {
      if (!deleted.has(id) || windows.some((window) => window.tabs.includes(id))) continue;
      const target = nearestLegacyWindow({ windows, survivorIds, sourceWindowId: sourceWindow.id, id, sourceIds: ids });
      insertNearNeighbors({ tabs: target.tabs, id, sourceIds: ids });
    }
  }
  const pinned = new Map(arrangement.source.windows.flatMap((window) => window.tabs).map((tab) => [tab.id, tab.pinned]));
  for (const window of windows) {
    window.tabs = [
      ...window.tabs.filter((id) => pinned.get(id) === true),
      ...window.tabs.filter((id) => pinned.get(id) !== true),
    ];
  }
  return { windows, close: [...arrangement.proposal.close] };
}

function nearestLegacyWindow(options: {
  windows: ArrangementData["proposal"]["windows"];
  survivorIds: Set<string>;
  sourceWindowId: string;
  id: string;
  sourceIds: string[];
}): ArrangementData["proposal"]["windows"][number] {
  const { windows, survivorIds, sourceWindowId, id, sourceIds } = options;
  const sourceIndex = sourceIds.indexOf(id);
  for (let distance = 1; distance < sourceIds.length; distance += 1) {
    const neighbors = [sourceIds[sourceIndex - distance], sourceIds[sourceIndex + distance]];
    const target = windows.find((window) => neighbors.some(
      (neighbor) => neighbor !== undefined && survivorIds.has(neighbor) && window.tabs.includes(neighbor),
    ));
    if (target !== undefined) return target;
  }
  const sameWindow = windows.find((window) => window.id === sourceWindowId);
  if (sameWindow !== undefined) return sameWindow;
  const created = { id: sourceWindowId, tabs: [] };
  windows.push(created);
  return created;
}

function insertNearNeighbors(options: { tabs: string[]; id: string; sourceIds: string[] }): void {
  const { tabs, id, sourceIds } = options;
  const sourceIndex = sourceIds.indexOf(id);
  for (let index = sourceIndex - 1; index >= 0; index -= 1) {
    const preceding = tabs.indexOf(sourceIds[index] ?? "");
    if (preceding !== -1) {
      tabs.splice(preceding + 1, 0, id);
      return;
    }
  }
  for (let index = sourceIndex + 1; index < sourceIds.length; index += 1) {
    const following = tabs.indexOf(sourceIds[index] ?? "");
    if (following !== -1) {
      tabs.splice(following, 0, id);
      return;
    }
  }
  tabs.push(id);
}

function parseArrangement(frontmatter: Record<string, unknown> | undefined): ArrangementData | null {
  if (frontmatter === undefined) return null;
  const transferId = frontmatter["transfer-id"];
  const status = frontmatter["status"];
  const source = parseSource(frontmatter["source"]);
  const proposal = parseProposal(frontmatter["proposal"]);
  if (typeof transferId !== "string" || (status !== "draft" && status !== "ready") || source === null || proposal === null) return null;
  return { transferId, status, source, proposal };
}

function parseSource(value: unknown): ArrangementData["source"] | null {
  if (!isObject(value) || !Array.isArray(value.windows)) return null;
  const windows: ArrangementData["source"]["windows"] = [];
  for (const rawWindow of value.windows) {
    if (!isObject(rawWindow) || typeof rawWindow.id !== "string" || !Array.isArray(rawWindow.tabs)) return null;
    const tabs: CapturedTab[] = [];
    for (const rawTab of rawWindow.tabs) {
      if (!isObject(rawTab)) return null;
      if (typeof rawTab.id !== "string" || typeof rawTab.title !== "string" || typeof rawTab.url !== "string" || typeof rawTab.pinned !== "boolean") return null;
      tabs.push({ id: rawTab.id, title: rawTab.title, url: rawTab.url, pinned: rawTab.pinned });
    }
    windows.push({ id: rawWindow.id, tabs });
  }
  return { windows };
}

function parseProposal(value: unknown): ArrangementData["proposal"] | null {
  if (!isObject(value) || !Array.isArray(value.windows) || !Array.isArray(value.close)) return null;
  if (!value.close.every((id) => typeof id === "string")) return null;
  const windows: ArrangementData["proposal"]["windows"] = [];
  for (const raw of value.windows) {
    if (!isObject(raw) || typeof raw.id !== "string" || !Array.isArray(raw.tabs)) return null;
    if (!raw.tabs.every((id) => typeof id === "string")) return null;
    windows.push({ id: raw.id, tabs: raw.tabs });
  }
  return { windows, close: value.close };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
