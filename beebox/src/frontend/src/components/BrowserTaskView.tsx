/**
 * BrowserTaskView — renderer for `browser-task` cards.
 *
 * The card is a prompt for someone with a logged-in browser, and the inbox
 * for what they bring back. Top to bottom: the task's state (open, due,
 * never scanned) and the owner's control; the copy block the executor needs;
 * the submission form, validated in the browser with the same function the
 * server runs; the prompt and schema, folded; the inbox and processed
 * batches as review tables; and the scan history.
 */

import { useCallback, useEffect, useState } from "react";
import type { RendererProps } from "../renderers";
import { Markdown } from "./Markdown";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Pre } from "./ui/Pre";
import { Row } from "./ui/Row";
import { Stack } from "./ui/Stack";
import { Text } from "./ui/Text";
import { Accordion } from "./ui/Accordion";
import { ExternalLink } from "./ui/ExternalLink";
import { bbxSource } from "../lib/source-tag";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { busEventData } from "../lib/bus-events";
import { attachDirFor } from "@shared/attach-path";
import { boxRelativePath } from "@shared/box-path";
import { validateBatch, MANIFEST_SHAPE_HINT } from "@shared/browser-task-batch";
import { isRecord } from "@shared/is-record";
import { SubmissionForm, type SubmissionValidation } from "./browser-task/SubmissionForm";
import { TaskStatus } from "./browser-task/TaskStatus";
import { BatchList } from "./browser-task/BatchList";
import { RunsTable } from "./browser-task/RunsTable";
import { INBOX_DIR, PROCESSED_DIR, fetchBoxText, loadBatches, schemaPath, type BatchSummary } from "./browser-task/browser-task-data";

interface AttachState {
  schemaText: string | null;
  schemaJson: unknown;
  /** Null when the schema converts cleanly; otherwise why the form is disabled. */
  schemaProblem: string | null;
  inbox: BatchSummary[];
  processed: BatchSummary[];
  error: string | null;
  /** When this snapshot was fetched; ages are computed against it, not against render time. */
  loadedAt: number;
}

export function BrowserTaskView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const { status, source, watermark, lastUpload, rescanAfter, subjectRef, limit } = readTaskFields(frontmatter);
  const body = data.body ?? "";
  const [attach, setAttach] = useState<AttachState | null>(null);

  const reload = useCallback(async () => {
    try {
      const [schemaText, inbox, processed] = await Promise.all([
        fetchBoxText(schemaPath(data.path)),
        loadBatches(data.path, INBOX_DIR),
        loadBatches(data.path, PROCESSED_DIR),
      ]);
      setAttach({ schemaText, ...probeSchema(schemaText), inbox, processed, error: null, loadedAt: Date.now() });
    } catch (e: unknown) {
      setAttach({ schemaText: null, schemaJson: null, schemaProblem: null, inbox: [], processed: [], error: e instanceof Error ? e.message : String(e), loadedAt: Date.now() });
    }
  }, [data.path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const cardRel = boxRelativePath(data.path);
  const attachRel = boxRelativePath(attachDirFor(data.path));
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const change = busEventData(event, "file-change");
      if (!change) return;
      const changed = boxRelativePath(change.path).replace(/\/$/, "");
      if (changed === cardRel || changed === attachRel || changed.startsWith(`${attachRel}/`)) void reload();
    }, [cardRel, attachRel, reload]),
  });

  const validate = useCallback(
    async ({ manifest, fileNames }: { manifest: unknown; fileNames: string[] }): Promise<SubmissionValidation> => {
      const result = validateBatch({ schemaJson: attach?.schemaJson, manifest, fileNames });
      return result.ok ? { ok: true, count: result.count } : { ok: false, issues: result.issues.map(({ path, message }) => ({ path, message })) };
    },
    [attach?.schemaJson],
  );

  const copyBlock = buildCopyBlock({ body, source, watermark, limit, schemaText: attach?.schemaText ?? null, cardPath: data.path });

  const disabledReason =
    status === "closed" ? "This task is closed and does not accept submissions."
    : attach === null ? "Loading the record schema…"
    : attach.schemaProblem;

  return (
    <div className="p-4 max-w-3xl mx-auto" {...bbxSource("card", data.path)}>
      <Stack gap="md">
        <TaskStatus
          cardPath={data.path}
          status={status}
          lastUpload={lastUpload}
          rescanAfter={rescanAfter}
          subjectRef={subjectRef}
          inbox={attach?.inbox ?? []}
          processedCount={attach?.processed.length ?? 0}
          loadedAt={attach?.loadedAt ?? null}
          error={attach?.error ?? null}
          onNavigate={onNavigate}
        />

        <Row gap="sm" align="center" wrap>
          <Button intent="secondary" size="sm" flash={{ label: "Copied" }} onClick={() => navigator.clipboard.writeText(copyBlock)}>
            Copy prompt, schema and watermark
          </Button>
          <Text as="span" size="sm" tone="subtle">Everything the executor needs, as one block.</Text>
        </Row>

        <SubmissionForm cardPath={data.path} validate={validate} disabledReason={disabledReason} onAccepted={() => void reload()} />

        <Accordion title={<Text as="h2" size="lg" weight="bold">Prompt</Text>} defaultOpen={false}>
          <Stack gap="sm">
            {source !== null ? <Text as="p" size="sm">Start at <ExternalLink href={source}>{source}</ExternalLink></Text> : null}
            {limit !== null ? <Text as="p" size="sm">Bound: {limit}</Text> : null}
            {watermark !== null ? <Text as="p" size="sm">Watermark: <Text as="span" mono>{watermark}</Text></Text> : null}
            <Markdown onNavigate={onNavigate} basePath={data.path}>{body}</Markdown>
          </Stack>
        </Accordion>

        <SchemaCard attach={attach} />

        <BatchList heading="Inbox" batches={attach?.inbox ?? []} empty="Nothing waiting." schemaJson={attach?.schemaJson} onNavigate={onNavigate} />
        <BatchList heading="Processed" batches={attach?.processed ?? []} empty="Nothing drained yet." schemaJson={attach?.schemaJson} onNavigate={onNavigate} />
        <RunsTable runs={frontmatter["runs"]} />
      </Stack>
    </div>
  );
}

function SchemaCard({ attach }: { attach: AttachState | null }) {
  let content;
  if (attach === null) content = <Text as="p" tone="subtle">Loading…</Text>;
  else if (attach.schemaText === null) content = <Text as="p" tone="danger">Missing: put a JSON Schema for one record at attach/schema.json.</Text>;
  else content = <Pre boxed scroll="md">{attach.schemaText}</Pre>;
  const problem = attach !== null && attach.schemaText !== null ? attach.schemaProblem : null;
  return (
    <Accordion title={<Text as="h2" size="lg" weight="bold">Record schema</Text>} defaultOpen={false}>
      <Card padding="sm" border="none">
        <Stack gap="sm">
          {content}
          {problem !== null ? <Text as="p" tone="danger" size="sm">{problem}</Text> : null}
        </Stack>
      </Card>
    </Accordion>
  );
}

interface TaskFields {
  status: "open" | "closed";
  source: string | null;
  watermark: string | null;
  lastUpload: string | null;
  rescanAfter: string | null;
  subjectRef: string | null;
  limit: string | null;
}

/** Narrow the card's frontmatter to what the view shows; a malformed value reads as absent. */
function readTaskFields(fm: Record<string, unknown>): TaskFields {
  const str = (key: string): string | null => (typeof fm[key] === "string" ? fm[key] : null);
  const subject = fm["subject"];
  return {
    status: fm["status"] === "closed" ? "closed" : "open",
    source: str("source"),
    watermark: str("watermark"),
    lastUpload: str("last-upload"),
    rescanAfter: str("rescan-after"),
    subjectRef: isRecord(subject) && typeof subject["ref"] === "string" ? subject["ref"] : null,
    limit: describeLimit(fm["limit"]),
  };
}

/** Everything the executor needs, as one block to paste into its own session. */
function buildCopyBlock(opts: { body: string; source: string | null; watermark: string | null; limit: string | null; schemaText: string | null; cardPath: string }): string {
  const parts = [opts.body.trim()];
  if (opts.source !== null) parts.push(`Start at: ${opts.source}`);
  if (opts.limit !== null) parts.push(`Bound: ${opts.limit}`);
  if (opts.watermark !== null) parts.push(`Stop at the watermark: ${opts.watermark}`);
  if (opts.schemaText !== null) parts.push("Each record must match this JSON Schema:\n```json\n" + opts.schemaText.trim() + "\n```");
  parts.push(`Submit at this card's page as a batch: ${MANIFEST_SHAPE_HINT} Upload records.json plus every file a record names.`);
  parts.push(`Submit at this card's page: ${opts.cardPath}`);
  return parts.join("\n\n");
}

/** The `limit` field as one readable line, or null when unset or malformed. */
function describeLimit(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const parts: string[] = [];
  if (typeof value["posts"] === "number") parts.push(`at most ${String(value["posts"])} posts`);
  if (typeof value["since"] === "string") parts.push(`nothing older than ${value["since"]}`);
  return parts.length === 0 ? null : parts.join(", ");
}

/** Convert the schema once so the form can be disabled when it cannot be used. */
function probeSchema(schemaText: string | null): { schemaJson: unknown; schemaProblem: string | null } {
  if (schemaText === null) return { schemaJson: null, schemaProblem: "The task has no record schema yet." };
  let schemaJson: unknown;
  try {
    schemaJson = JSON.parse(schemaText);
  } catch (e: unknown) {
    return { schemaJson: null, schemaProblem: `attach/schema.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const probe = validateBatch({ schemaJson, manifest: { coverage: { scanned: 0, stoppedAt: "", reason: "error" }, records: [] }, fileNames: [] });
  if (!probe.ok) {
    const schemaIssue = probe.issues.find((i) => i.kind === "schema");
    if (schemaIssue !== undefined) return { schemaJson, schemaProblem: schemaIssue.message };
  }
  return { schemaJson, schemaProblem: null };
}
