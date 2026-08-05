import { useCallback, useEffect, useMemo, useState } from "react";
import type { RendererProps } from "../renderers";
import { cbSource } from "../lib/source-tag";
import { requestTabArrangement, type ArrangementRelayResult } from "../lib/tab-arrangement-relay";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
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
  const [relay, setRelay] = useState<ArrangementRelayResult | null>(null);

  useEffect(() => {
    if (arrangement === null) return;
    void requestTabArrangement({ action: "status", transferId: arrangement.transferId }).then(setRelay);
  }, [arrangement]);

  const apply = useCallback(async () => {
    if (arrangement === null) return;
    setRelay(await requestTabArrangement({
      action: "apply",
      transferId: arrangement.transferId,
      proposal: arrangement.proposal,
    }));
  }, [arrangement]);

  const undo = useCallback(async () => {
    if (arrangement === null) return;
    setRelay(await requestTabArrangement({ action: "undo", transferId: arrangement.transferId }));
  }, [arrangement]);

  if (arrangement === null) {
    return <Text as="div" tone="danger" className="p-4">This tab arrangement card is malformed. Open Source to repair it.</Text>;
  }
  const tabs = new Map(arrangement.source.windows.flatMap((window) => window.tabs).map((tab) => [tab.id, tab]));
  const canApply = arrangement.status === "ready" && relay?.ok === true && relay.state === "ready";

  return (
    <div className="mx-auto max-w-4xl p-4" {...cbSource("card", data.path)}>
      <Stack gap="lg">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Text as="h1" size="lg" weight="semibold">Tab arrangement</Text>
            <Badge tone={arrangement.status === "ready" ? "success" : "warning"}>{arrangement.status}</Badge>
          </div>
          <Text as="p" size="sm" tone="subtle" className="mt-1">
            Review the proposed windows below. Clerk validates the live tabs again before changing anything.
          </Text>
        </header>

        <Stack gap="md">
          {arrangement.proposal.windows.map((window, index) => (
            <Card key={window.id} as="section" aria-label={`Proposed window ${index + 1}`} background="warm">
              <Text as="h2" weight="semibold" className="mb-2">Window {index + 1}</Text>
              <ol className="space-y-2">
                {window.tabs.map((id) => <TabRow key={id} tab={tabs.get(id)} />)}
              </ol>
            </Card>
          ))}
          <Card as="section" aria-label="Tabs to close" border="subtle">
            <Text as="h2" weight="semibold" className="mb-2">Close ({arrangement.proposal.close.length})</Text>
            {arrangement.proposal.close.length === 0 ? (
              <Text as="p" size="sm" tone="subtle">No tabs will be closed.</Text>
            ) : (
              <ul className="space-y-2">
                {arrangement.proposal.close.map((id) => <TabRow key={id} tab={tabs.get(id)} />)}
              </ul>
            )}
          </Card>
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

function TabRow({ tab }: { tab: CapturedTab | undefined }) {
  if (tab === undefined) return <li className="text-sm text-danger">Unknown tab UUID</li>;
  return (
    <li className="min-w-0 rounded border border-warm-200 bg-white px-3 py-2">
      <div className="flex items-start gap-2">
        {tab.pinned ? <Badge size="sm" tone="info">Pinned</Badge> : null}
        <div className="min-w-0">
          <Text as="div" size="sm" weight="medium" className="truncate">{tab.title}</Text>
          <Text as="div" size="xs" tone="subtle" className="truncate">{tab.url}</Text>
        </div>
      </div>
    </li>
  );
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
