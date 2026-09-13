/**
 * Batches of a browser-task card, each expandable into a review table.
 *
 * The table is schema-driven: columns are the record schema's short scalar
 * properties (name-like and date-like first), and a row expands to the whole
 * record, so the notes and raw text the executor wrote are one click away.
 * This is the step that needs the most judgment, so it is the one that should
 * read at a glance instead of as a JSON blob.
 */

import { useState } from "react";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { InlineAction } from "../ui/InlineAction";
import { Accordion } from "../ui/Accordion";
import { JsonView } from "../ui/JsonView";
import { isRecord } from "@shared/is-record";
import type { RendererProps } from "../../renderers";
import type { BatchSummary } from "./browser-task-data";

const MAX_COLUMNS = 5;
/** Property names that read as long text and belong in the expanded row, not a column. */
const LONG_TEXT = /text|notes?|description|body|caption|summary/i;
/** Property names that should lead the table when present. */
const LEAD_ORDER = [/^(name|title|event)$/i, /^(start|date|when|posted)/i, /^(venue|where|place)$/i, /^(group)$/i, /^(unsure|confidence|sure)$/i];

/** Pick the table's columns from the record schema; falls back to the first record's keys. */
export function pickColumns(schemaJson: unknown, sample: unknown): string[] {
  const props = isRecord(schemaJson) && isRecord(schemaJson["properties"]) ? schemaJson["properties"] : null;
  const candidates: string[] = [];
  if (props !== null) {
    for (const [key, sub] of Object.entries(props)) {
      if (!isRecord(sub)) continue;
      const type = sub["type"];
      const scalar = type === "string" || type === "number" || type === "integer" || type === "boolean" || (Array.isArray(type) && type.some((t) => t === "string" || t === "number" || t === "boolean"));
      if (scalar && !LONG_TEXT.test(key) && sub["format"] !== "attachment" && sub["format"] !== "uri") candidates.push(key);
    }
  } else if (isRecord(sample)) {
    for (const [key, value] of Object.entries(sample)) {
      if ((typeof value === "string" && value.length <= 60) || typeof value === "number" || typeof value === "boolean") candidates.push(key);
    }
  }
  const lead = LEAD_ORDER.flatMap((re) => candidates.filter((c) => re.test(c)));
  const rest = candidates.filter((c) => !lead.includes(c));
  return [...new Set([...lead, ...rest])].slice(0, MAX_COLUMNS);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function BatchList({ heading, batches, empty, schemaJson, onNavigate }: {
  heading: string;
  batches: BatchSummary[];
  empty: string;
  schemaJson: unknown;
  onNavigate: RendererProps["onNavigate"];
}) {
  return (
    <Card padding="md">
      <Stack gap="sm">
        <Text as="h2" size="lg" weight="bold">{heading}</Text>
        {batches.length === 0 ? <Text as="p" tone="subtle">{empty}</Text> : batches.map((b) => (
          <Accordion key={b.id} variant="plain" title={<BatchTitle batch={b} />}>
            <BatchTable batch={b} schemaJson={schemaJson} onNavigate={onNavigate} />
          </Accordion>
        ))}
      </Stack>
    </Card>
  );
}

function BatchTitle({ batch }: { batch: BatchSummary }) {
  return (
    <Row gap="sm" align="center" wrap>
      <Text as="span" mono>{batch.id}</Text>
      <Text as="span">{batch.records === null ? "records.json unreadable" : `${String(batch.records)} records`}</Text>
      {batch.coverage !== null ? (
        <Text as="span" tone="subtle">scanned {String(batch.coverage.scanned)}, stopped: {batch.coverage.reason}{batch.coverage.stoppedAt !== "" ? ` at ${batch.coverage.stoppedAt}` : ""}</Text>
      ) : null}
      {batch.filed.length > 0 ? <Text as="span" tone="subtle">{String(batch.filed.length)} filed</Text> : null}
    </Row>
  );
}

function BatchTable({ batch, schemaJson, onNavigate }: { batch: BatchSummary; schemaJson: unknown; onNavigate: RendererProps["onNavigate"] }) {
  const [open, setOpen] = useState<number | null>(null);
  const columns = pickColumns(schemaJson, batch.rows[0]);
  const filed = new Set(batch.filed);
  const openFile = (
    <InlineAction intent="subtle" onClick={() => onNavigate({ path: `${batch.dir}/records.json`, viewer: null, params: {}, viewState: null })}>
      open records.json
    </InlineAction>
  );
  if (batch.rows.length === 0) return <Text as="p" tone="subtle">No records in this batch. {openFile}</Text>;
  return (
    <Stack gap="xs">
      <Row gap="sm" align="center" wrap>
        {batch.coverage?.notes !== undefined ? <Text as="span" size="sm" tone="subtle">Executor notes: {batch.coverage.notes}</Text> : null}
        {openFile}
      </Row>
      <div className="overflow-x-auto">
        <RecordsGrid rows={batch.rows} columns={columns} filed={filed} open={open} onToggle={(i) => setOpen(open === i ? null : i)} />
      </div>
    </Stack>
  );
}

function RecordsGrid({ rows, columns, filed, open, onToggle }: { rows: unknown[]; columns: string[]; filed: Set<number>; open: number | null; onToggle: (i: number) => void }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="text-left pr-2">#</th>
          {columns.map((c) => <th key={c} className="text-left pr-2">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <RecordRow key={i} index={i} row={row} columns={columns} filed={filed.has(i)} open={open === i} onToggle={() => onToggle(i)} />
        ))}
      </tbody>
    </table>
  );
}

function RecordRow({ index, row, columns, filed, open, onToggle }: { index: number; row: unknown; columns: string[]; filed: boolean; open: boolean; onToggle: () => void }) {
  const rec = isRecord(row) ? row : {};
  return (
    <>
      <tr className="align-top">
        <td className="pr-2">
          <InlineAction intent="subtle" onClick={onToggle}>{open ? "▾" : "▸"} {String(index)}{filed ? " ✓" : ""}</InlineAction>
        </td>
        {columns.map((c) => <td key={c} className="pr-2">{cell(rec[c])}</td>)}
      </tr>
      {open ? (
        <tr>
          <td colSpan={columns.length + 1} className="pb-2">
            <JsonView value={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
