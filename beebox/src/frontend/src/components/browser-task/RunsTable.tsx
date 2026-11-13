/**
 * The card's scan history (`runs:`), newest first: what each drained batch
 * covered and where it stopped.
 */

import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Heading } from "../ui/Heading";
import { FriendlyDate } from "../ui/FriendlyDate";
import { Table, Td, Th } from "../ui/Table";
import { useId } from "react";
import { isRecord } from "@shared/is-record";
import type { BrowserTaskRunEntry } from "@schemas/browser-task";

/** Reason is widened to `string`: a card written by an older schema version may carry a value outside the current enum, and this table only ever displays it as text. */
type RunRow = Omit<BrowserTaskRunEntry, "note" | "reason"> & { note: string | null; reason: string };

/** Narrow the frontmatter `runs` value to rows the table can show; malformed entries are dropped. */
function parseRuns(value: unknown): RunRow[] {
  if (!Array.isArray(value)) return [];
  const rows: RunRow[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const num = (k: string): number => (typeof entry[k] === "number" ? entry[k] : 0);
    if (typeof entry["batch"] !== "string" || typeof entry["at"] !== "string") continue;
    rows.push({
      batch: entry["batch"],
      at: entry["at"],
      scanned: num("scanned"),
      kept: num("kept"),
      filed: num("filed"),
      skipped: num("skipped"),
      reason: typeof entry["reason"] === "string" ? entry["reason"] : "",
      stoppedAt: typeof entry["stoppedAt"] === "string" ? entry["stoppedAt"] : "",
      note: typeof entry["note"] === "string" ? entry["note"] : null,
    });
  }
  return rows.toReversed();
}

export function RunsTable({ runs }: { runs: unknown }) {
  const headingId = useId();
  const rows = parseRuns(runs);
  if (rows.length === 0) return null;
  return (
    <Card padding="md">
      <Stack gap="sm">
        <Heading level={2} id={headingId}>Runs</Heading>
        <RunsGrid rows={rows} labelledBy={headingId} />
      </Stack>
    </Card>
  );
}

const HEADERS = ["when", "scanned", "kept", "filed", "skipped", "stopped", "note"];
const NUMERIC = new Set(["scanned", "kept", "filed", "skipped"]);

function RunsGrid({ rows, labelledBy }: { rows: RunRow[]; labelledBy: string }) {
  return (
    <Table labelledBy={labelledBy} className="text-sm">
      <thead>
        <tr>{HEADERS.map((h) => <Th key={h} scope="col" numeric={NUMERIC.has(h)}>{h}</Th>)}</tr>
      </thead>
      <tbody>{rows.map((r) => <RunRowView key={r.batch} run={r} />)}</tbody>
    </Table>
  );
}

function RunRowView({ run: r }: { run: RunRow }) {
  return (
    <tr>
      <Td><FriendlyDate iso={r.at} mode="date" /></Td>
      <Td numeric>{String(r.scanned)}</Td>
      <Td numeric>{String(r.kept)}</Td>
      <Td numeric>{String(r.filed)}</Td>
      <Td numeric>{String(r.skipped)}</Td>
      <Td>{r.reason}{r.stoppedAt !== "" ? ` at ${r.stoppedAt}` : ""}</Td>
      <Td>{r.note ?? ""}</Td>
    </tr>
  );
}
