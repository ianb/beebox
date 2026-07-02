/**
 * Sheet card renderer — read-only spreadsheet view with tabs.
 */

import { isRecord } from "../lib/is-record";
import { useState, useEffect } from "react";
import type { RendererProps } from "./index";
import { registerCardRenderer } from "./index";
import { getApiBase } from "../api";
import { TabBar } from "../components/ui/TabBar";
import { Text } from "../components/ui/Text";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { ExternalLink } from "../components/ui/ExternalLink";
import { SheetTable, type CellValue } from "../components/SheetTable";
import { AttachedComments } from "../components/AttachedComments";
import { resolveRelativePath } from "../lib/view-url";

// ─── Parsing ────────────────────────────────────────────────────────────────

interface ParsedSheet {
  title: string;
  modified: string;
  link: string;
  owner: string;
  driveId: string;
  tabs: Array<{ ref: string; title: string; gid: string }>;
}

function strOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseSheetFrontmatter(fm: Record<string, unknown>): ParsedSheet {
  const tabs = Array.isArray(fm.sheets)
    ? fm.sheets.flatMap((tab) =>
        isRecord(tab)
          ? [{ ref: strOf(tab.ref), title: strOf(tab.title), gid: strOf(tab.gid) }]
          : [],
      )
    : [];

  return {
    title: strOf(fm.title),
    modified: strOf(fm.modified),
    link: strOf(fm.link),
    owner: strOf(fm.owner),
    driveId: strOf(fm["drive-id"]),
    tabs,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

function SheetView({ data }: RendererProps) {
  const sheet = data.frontmatter ? parseSheetFrontmatter(data.frontmatter) : null;
  const [activeTabGid, setActiveTabGid] = useState<string>("");
  const [tabData, setTabData] = useState<Map<string, CellValue[][]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sheet) return;
    let cancelled = false;

    async function loadTabs() {
      setLoading(true);
      const results = new Map<string, CellValue[][]>();

      for (const tab of sheet!.tabs) {
        try {
          const filePath = resolveRelativePath(data.path, tab.ref);
          const resp = await fetch(`${getApiBase()}/files/${filePath}`);
          if (resp.ok) {
            const json = await resp.json();
            results.set(tab.title, json);
          }
        } catch (e) {
          console.warn("Failed to load sheet tab data; skipping tab:", e);
          // Skip failed tabs
        }
      }

      if (!cancelled) {
        setTabData(results);
        setLoading(false);
      }
    }

    loadTabs();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.path]);

  if (!sheet) return null;

  const firstTabGid = sheet.tabs.length > 0 ? sheet.tabs[0].gid : "";
  const selectedGid = activeTabGid || firstTabGid;
  const currentTab = sheet.tabs.find((t) => t.gid === selectedGid);
  const currentRows = currentTab ? (tabData.get(currentTab.title) ?? []) : [];

  return (
    <Stack gap="md">
      {/* Header */}
      <Row justify="between" align="start">
        <div>
          <Text as="h2" size="lg" weight="semibold">{sheet.title}</Text>
          {sheet.modified ? (
            <Text as="p" size="xs" tone="muted">
              Last synced: {new Date(sheet.modified).toLocaleString()}
            </Text>
          ) : null}
        </div>
        <ExternalLink href={sheet.link} variant="button">Open in Google Sheets</ExternalLink>
      </Row>

      {/* Tab bar */}
      {sheet.tabs.length > 1 ? (
        <TabBar
          label="Sheet tabs"
          value={selectedGid}
          onChange={setActiveTabGid}
          tabs={sheet.tabs.map((tab) => ({ value: tab.gid, label: tab.title }))}
        />
      ) : null}

      {/* Table */}
      {loading ? (
        <Text size="sm" tone="muted">Loading spreadsheet data...</Text>
      ) : (
        <SheetTable rows={currentRows} />
      )}

      <AttachedComments cardPath={data.path} frontmatter={data.frontmatter} />
    </Stack>
  );
}

// ─── Registration ───────────────────────────────────────────────────────────

registerCardRenderer("sheet", {
  name: "Spreadsheet",
  Component: SheetView,
  priority: 100,
});
