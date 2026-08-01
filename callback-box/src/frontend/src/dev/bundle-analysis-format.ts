/**
 * Formats a `BundleReport` into the plain-text tables `analyze-bundle.ts`
 * prints. Pure string building — no I/O — so the CLI script stays a thin
 * "run the build, read the JSON, print this" shell.
 */

import { formatBytes } from "../lib/format-bytes";
import type { BundleReport } from "./bundle-analysis-types";

/** Heavy/notable deps the load-time investigation cares about — reported by
 * name even when a package attributes as absent (never bundled at all). */
const WATCHED_PACKAGES = [
  "three",
  "p5",
  "d3",
  "highlight.js",
  "ldrs",
  "@xyflow/react",
  "dagre",
  "@markdoc/markdoc",
  "xstate",
];

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function renderTable(params: { headers: string[]; rows: string[][] }): string {
  const { headers, rows } = params;
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? "").length)),
  );
  const renderRow = (cells: string[]): string =>
    cells.map((cell, col) => (col === 0 ? padRight(cell, widths[col] ?? 0) : padLeft(cell, widths[col] ?? 0))).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  return [renderRow(headers), separator, ...rows.map(renderRow)].join("\n");
}

function formatTotalsSection(report: BundleReport): string {
  const { totals } = report;
  const lines = [
    "== Initial load (raw / gzip) ==",
    `JS:  ${formatBytes(totals.initialJsRawBytes)} / ${formatBytes(totals.initialJsGzipBytes)}`,
    `CSS: ${formatBytes(totals.initialCssRawBytes)} / ${formatBytes(totals.initialCssGzipBytes)}`,
    `Total: ${formatBytes(totals.initialJsRawBytes + totals.initialCssRawBytes)} / ${formatBytes(totals.initialJsGzipBytes + totals.initialCssGzipBytes)}`,
    "",
    `Async (code-split) JS: ${formatBytes(totals.asyncJsRawBytes)} / ${formatBytes(totals.asyncJsGzipBytes)}`,
  ];
  return lines.join("\n");
}

function formatChunksSection(report: BundleReport): string {
  const asyncCount = report.chunks.filter((chunk) => !chunk.isInitial).length;
  const rows = report.chunks.map((chunk) => [
    chunk.fileName,
    chunk.isInitial ? "initial" : "async",
    formatBytes(chunk.rawBytes),
    formatBytes(chunk.gzipBytes),
  ]);
  return [
    `== Chunks (${report.chunks.length} total, ${asyncCount} async / code-split) ==`,
    renderTable({ headers: ["chunk", "load", "raw", "gzip"], rows }),
  ].join("\n");
}

function formatPackagesSection(report: BundleReport, limit: number): string {
  const rows = report.packages.slice(0, limit).map((pkg) => [
    pkg.package,
    formatBytes(pkg.rawBytes),
    formatBytes(pkg.gzipBytes),
    pkg.initialRawBytes > 0 ? "initial" : "async-only",
  ]);
  return [
    `== Top ${Math.min(limit, report.packages.length)} packages by raw size ==`,
    renderTable({ headers: ["package", "raw", "gzip", "load"], rows }),
  ].join("\n");
}

function formatWatchedPackagesSection(report: BundleReport): string {
  const rows = WATCHED_PACKAGES.map((packageName) => {
    const pkg = report.packages.find((candidate) => candidate.package === packageName);
    if (pkg === undefined) return [packageName, "absent", "-", "-"];
    const chunkList = [...new Set(pkg.chunkFileNames)].join(", ");
    return [packageName, pkg.initialRawBytes > 0 ? "initial" : "async", formatBytes(pkg.rawBytes), chunkList];
  });
  return [
    "== Watched heavy dependencies ==",
    renderTable({ headers: ["package", "load", "raw", "chunks"], rows }),
  ].join("\n");
}

export function formatBundleReport(report: BundleReport, params: { topPackages: number }): string {
  return [
    formatTotalsSection(report),
    "",
    formatChunksSection(report),
    "",
    formatWatchedPackagesSection(report),
    "",
    formatPackagesSection(report, params.topPackages),
  ].join("\n");
}
