/**
 * Sheet card renderer — read-only spreadsheet view with tabs.
 */

import { useState, useEffect } from "react";
import type { RendererProps } from "./index";
import { registerCardRenderer } from "./index";
import type { ElementNode } from "../api";
import { getApiBase } from "../api";

// ─── Parsing ────────────────────────────────────────────────────────────────

interface ParsedSheet {
  title: string;
  modified: string;
  link: string;
  owner: string;
  driveId: string;
  tabs: Array<{ file: string; title: string; gid: string }>;
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
              file: tab.attrs["file"] ?? "",
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

// ─── Cell types ─────────────────────────────────────────────────────────────

interface FormulaCell {
  f: string;
  v: string;
}

type CellValue = string | number | boolean | null | FormulaCell;

function isFormulaCell(cell: CellValue): cell is FormulaCell {
  return cell !== null && typeof cell === "object" && "f" in cell;
}

// ─── Column letter helpers ──────────────────────────────────────────────────

function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCodePoint(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// ─── Components ─────────────────────────────────────────────────────────────

function SheetTable({ rows }: { rows: CellValue[][] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-warm-500 italic">Empty sheet</p>;
  }

  const maxCols = Math.max(...rows.map((r) => r.length));

  return (
    <div className="overflow-auto border border-warm-300 rounded">
      <table className="border-collapse text-xs font-mono w-full">
        <thead>
          <tr className="bg-warm-100 sticky top-0 z-10">
            <th className="border-r border-b border-warm-300 px-2 py-1 text-warm-500 font-normal w-10 text-right sticky left-0 bg-warm-100 z-20">
              {/* row number column header */}
            </th>
            {Array.from({ length: maxCols }, (_, i) => (
              <th
                key={i}
                className="border-r border-b border-warm-300 px-2 py-1 text-warm-500 font-normal text-center min-w-[60px]"
              >
                {columnLetter(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-warm-50">
              <td className="border-r border-b border-warm-200 px-2 py-1 text-warm-400 text-right bg-warm-50 sticky left-0">
                {rowIdx + 1}
              </td>
              {Array.from({ length: maxCols }, (_, colIdx) => {
                const cell = row[colIdx] ?? "";
                const formula = isFormulaCell(cell);
                const display = formula ? cell.v : String(cell ?? "");
                return (
                  <td
                    key={colIdx}
                    className={`border-r border-b border-warm-200 px-2 py-1 whitespace-pre-wrap ${formula ? "text-plum" : "text-warm-900"}`}
                    title={formula ? cell.f : undefined}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SheetView({ data }: RendererProps) {
  const el = data.element;
  const sheet = el ? parseSheetElement(el) : null;
  const [activeTab, setActiveTab] = useState(0);
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
          const filePath = cardDir + tab.file;
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

  const currentTab = sheet.tabs[activeTab];
  const currentRows = currentTab ? (tabData.get(currentTab.title) ?? []) : [];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-warm-900">{sheet.title}</h2>
          {sheet.modified ? (
            <p className="text-xs text-warm-500">
              Last synced: {new Date(sheet.modified).toLocaleString()}
            </p>
          ) : null}
        </div>
        <a
          href={sheet.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-warm-300 rounded hover:bg-warm-50 text-warm-700"
        >
          Open in Google Sheets
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* Tab bar */}
      {sheet.tabs.length > 1 ? (
        <div className="flex gap-0 border-b border-warm-300">
          {sheet.tabs.map((tab, i) => (
            <button
              key={tab.gid}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-1.5 text-sm border-b-2 transition-colors ${
                i === activeTab
                  ? "border-plum text-plum font-medium"
                  : "border-transparent text-warm-600 hover:text-warm-800 hover:border-warm-300"
              }`}
            >
              {tab.title}
            </button>
          ))}
        </div>
      ) : null}

      {/* Table */}
      {loading ? (
        <p className="text-sm text-warm-500">Loading spreadsheet data...</p>
      ) : (
        <SheetTable rows={currentRows} />
      )}
    </div>
  );
}

// ─── Registration ───────────────────────────────────────────────────────────

registerCardRenderer("sheet", {
  name: "Spreadsheet",
  Component: SheetView,
  priority: 100,
});
