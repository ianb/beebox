/**
 * The card's scan history (`runs:`), newest first: what each drained batch
 * covered and where it stopped.
 */

import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { FriendlyDate } from "../ui/FriendlyDate";
import { isRecord } from "@shared/is-record";

interface RunRow {
  batch: string;
  at: string;
  scanned: number;
  kept: number;
  filed: number;
  skipped: number;
  reason: string;
  stoppedAt: string;
  note: string | null;
}

/** Narrow the frontmatter `runs` value to rows the table can show; malformed entries are dropped. */
export function parseRuns(value: unknown): RunRow[] {
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
  const rows = parseRuns(runs);
  if (rows.length === 0) return null;
  return (
    <Card padding="md">
      <Stack gap="sm">
        <Text as="h2" size="lg" weight="bold">Runs</Text>
        <div className="overflow-x-auto">
          <RunsGrid rows={rows} />
        </div>
      </Stack>
    </Card>
  );
}

const HEADERS = ["when", "scanned", "kept", "filed", "skipped", "stopped", "note"];

function RunsGrid({ rows }: { rows: RunRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>{HEADERS.map((h) => <th key={h} className="text-left pr-2">{h}</th>)}</tr>
      </thead>
      <tbody>{rows.map((r) => <RunRowView key={r.batch} run={r} />)}</tbody>
    </table>
  );
}

function RunRowView({ run: r }: { run: RunRow }) {
  return (
    <tr className="align-top">
      <td className="pr-2"><FriendlyDate iso={r.at} mode="date" /></td>
      <td className="pr-2">{String(r.scanned)}</td>
      <td className="pr-2">{String(r.kept)}</td>
      <td className="pr-2">{String(r.filed)}</td>
      <td className="pr-2">{String(r.skipped)}</td>
      <td className="pr-2">{r.reason}{r.stoppedAt !== "" ? ` at ${r.stoppedAt}` : ""}</td>
      <td className="pr-2">{r.note ?? ""}</td>
    </tr>
  );
}
