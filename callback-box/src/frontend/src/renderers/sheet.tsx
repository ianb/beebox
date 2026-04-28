/**
 * Sheet card renderer — read-only spreadsheet view with tabs.
 */

import { useState, useEffect } from "react";
import type { RendererProps } from "./index";
import { registerCardRenderer } from "./index";
import type { ElementNode } from "../api";
import { getApiBase } from "../api";
import { TabBar } from "../components/ui/TabBar";
import { Text } from "../components/ui/Text";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { ExternalLink } from "../components/ui/ExternalLink";
import { SheetTable, type CellValue } from "../components/SheetTable";

// ─── Parsing ────────────────────────────────────────────────────────────────

interface ParsedSheet {
  title: string;
  modified: string;
  link: string;
  owner: string;
  driveId: string;
  tabs: Array<{ ref: string; title: string; gid: string }>;
}

function parseSheetElement(el: ElementNode): ParsedSheet {
  const result: ParsedSheet = {
    title: "",
    modified: "",
    link: "",
    owner: "",
    driveId: el.attrs["drive-id"] ?? "",
    tabs: [],
  };

  for (const child of el.children ?? []) {
    switch (child.tagName) {
      case "title":
        result.title = child.text ?? "";
        break;
      case "modified":
        result.modified = child.text ?? "";
        break;
      case "link":
        result.link = child.text ?? "";
        break;
      case "owner":
        result.owner = child.text ?? "";
        break;
      case "sheets":
        for (const tab of child.children ?? []) {
          if (tab.tagName === "sheet-tab") {
            result.tabs.push({
              ref: tab.attrs["ref"] ?? "",
              title: tab.attrs["title"] ?? "",
              gid: tab.attrs["gid"] ?? "",
            });
          }
        }
        break;
    }
  }

  return result;
}

// ─── Component ──────────────────────────────────────────────────────────────

function SheetView({ data }: RendererProps) {
  const el = data.element;
  const sheet = el ? parseSheetElement(el) : null;
  const [activeTabGid, setActiveTabGid] = useState<string>("");
  const [tabData, setTabData] = useState<Map<string, CellValue[][]>>(new Map());
  const [loading, setLoading] = useState(true);

  const cardDir = data.path.replace(/[^/]+$/, "");

  useEffect(() => {
    if (!sheet) return;
    let cancelled = false;

    async function loadTabs() {
      setLoading(true);
      const results = new Map<string, CellValue[][]>();

      for (const tab of sheet!.tabs) {
        try {
          const filePath = cardDir + tab.ref;
          const resp = await fetch(`${getApiBase()}/files/${filePath}`);
          if (resp.ok) {
            const json = await resp.json();
            results.set(tab.title, json);
          }
        } catch {
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
    </Stack>
  );
}

// ─── Registration ───────────────────────────────────────────────────────────

registerCardRenderer("sheet", {
  name: "Spreadsheet",
  Component: SheetView,
  priority: 100,
});
