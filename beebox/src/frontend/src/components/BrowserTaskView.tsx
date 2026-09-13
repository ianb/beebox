/**
 * BrowserTaskView — renderer for `browser-task` cards.
 *
 * The card is a prompt for someone with a logged-in browser, and the inbox
 * for what they bring back. The view shows, top to bottom: the task's state
 * and inbox status; the prompt with a one-click copy of everything the
 * executor needs; the record schema; the submission form (validated in the
 * browser with the same function the server runs); and the batches that
 * have arrived or been drained.
 */

import { useCallback, useEffect, useState } from "react";
import type { RendererProps } from "../renderers";
import { Markdown } from "./Markdown";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { FriendlyDate } from "./ui/FriendlyDate";
import { Pre } from "./ui/Pre";
import { Row } from "./ui/Row";
import { Stack } from "./ui/Stack";
import { Text } from "./ui/Text";
import { Accordion } from "./ui/Accordion";
import { Toggle } from "./ui/Toggle";
import { trpc } from "../lib/trpc";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { ExternalLink } from "./ui/ExternalLink";
import { InlineAction } from "./ui/InlineAction";
import { bbxSource } from "../lib/source-tag";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { busEventData } from "../lib/bus-events";
import { attachDirFor } from "@shared/attach-path";
import { boxRelativePath } from "@shared/box-path";
import { validateBatch, MANIFEST_SHAPE_HINT } from "@shared/browser-task-batch";
import { SubmissionForm, type SubmissionValidation } from "./browser-task/SubmissionForm";
import { INBOX_DIR, PROCESSED_DIR, fetchBoxText, loadBatches, schemaPath, type BatchSummary } from "./browser-task/browser-task-data";

const STALE_AFTER_DAYS = 14;

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
  const status = frontmatter["status"] === "closed" ? "closed" : "open";
  const source = typeof frontmatter["source"] === "string" ? frontmatter["source"] : null;
  const watermark = typeof frontmatter["watermark"] === "string" ? frontmatter["watermark"] : null;
  const lastUpload = typeof frontmatter["last-upload"] === "string" ? frontmatter["last-upload"] : null;
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

  const limit = describeLimit(frontmatter["limit"]);
  const copyBlock = buildCopyBlock({ body, source, watermark, limit, schemaText: attach?.schemaText ?? null, cardPath: data.path });

  const disabledReason =
    status === "closed" ? "This task is closed and does not accept submissions."
    : attach === null ? "Loading the record schema…"
    : attach.schemaProblem;


  // Order: what state the task is in and the form to act on it come first;
  // the prompt and schema are reference material the executor copies once,
  // so they fold away rather than pushing everything else off the page.
  return (
    <div className="p-4 max-w-3xl mx-auto" {...bbxSource("card", data.path)}>
      <Stack gap="md">
        <StatusLine status={status} lastUpload={lastUpload} attach={attach} cardPath={data.path} />

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

        <BatchList heading="Inbox" batches={attach?.inbox ?? []} empty="Nothing waiting." onNavigate={onNavigate} />
        <BatchList heading="Processed" batches={attach?.processed ?? []} empty="Nothing drained yet." onNavigate={onNavigate} />
      </Stack>
    </div>
  );
}

function StatusLine({ status, lastUpload, attach, cardPath }: { status: "open" | "closed"; lastUpload: string | null; attach: AttachState | null; cardPath: string }) {
  const staleDays = lastUpload === null || attach === null ? null : Math.floor((attach.loadedAt - new Date(lastUpload).getTime()) / 86_400_000);
  const draining = attach?.inbox.filter((b) => b.filed.length > 0 && b.records !== null && b.filed.length < b.records).length ?? 0;
  return (
    <Stack gap="xs">
      <Row gap="sm" align="center" wrap>
        <Badge tone={status === "open" ? "success" : "neutral"}>{status}</Badge>
        <StatusToggle status={status} cardPath={cardPath} />
        {attach !== null ? (
          <Text as="span" size="sm">
            {String(attach.inbox.length)} in inbox, {String(attach.processed.length)} processed
            {draining > 0 ? `, ${String(draining)} being drained` : ""}
          </Text>
        ) : null}
        {lastUpload !== null ? (
          <Text as="span" size="sm" tone="subtle">last upload <FriendlyDate iso={lastUpload} /></Text>
        ) : (
          <Text as="span" size="sm" tone="subtle">no uploads yet</Text>
        )}
      </Row>
      {status === "open" && staleDays !== null && staleDays >= STALE_AFTER_DAYS ? (
        <Text as="p" tone="emphasis" size="sm">No upload in {String(staleDays)} days. Run the task or close it.</Text>
      ) : null}
      {attach?.error ? <Text as="p" tone="danger">{attach.error}</Text> : null}
    </Stack>
  );
}

function SchemaCard({ attach }: { attach: AttachState | null }) {
  let content;
  if (attach === null) content = <Text as="p" tone="subtle">Loading…</Text>;
  else if (attach.schemaText === null) content = <Text as="p" tone="danger">Missing: put a JSON Schema for one record at attach/schema.json.</Text>;
  else content = <Pre boxed scroll="md">{attach.schemaText}</Pre>;
  const problem = attach !== null && attach.schemaText !== null ? attach.schemaProblem : null;
  return (
    <Card padding="md">
      <Stack gap="sm">
        <Text as="h2" size="lg" weight="bold">Record schema</Text>
        {content}
        {problem !== null ? <Text as="p" tone="danger" size="sm">{problem}</Text> : null}
      </Stack>
    </Card>
  );
}

/** The boxholder's open/closed control. Owner only; an executor never sees it. */
function StatusToggle({ status, cardPath }: { status: "open" | "closed"; cardPath: string }) {
  const user = useCurrentUser();
  const utils = trpc.useUtils();
  const mutation = trpc.browserTask.setStatus.useMutation({
    onSuccess: async () => {
      await utils.card.get.invalidate({ path: cardPath });
    },
  });
  if (user === null || !user.isOwner) return null;
  return (
    <Toggle
      checked={status === "open"}
      disabled={mutation.isPending}
      label={status === "open" ? "Accepting batches" : "Closed"}
      onChange={(open) => mutation.mutate({ path: cardPath, status: open ? "open" : "closed" })}
    />
  );
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
  if (typeof value !== "object" || value === null) return null;
  const rec: Record<string, unknown> = { ...value };
  const parts: string[] = [];
  if (typeof rec["posts"] === "number") parts.push(`at most ${String(rec["posts"])} posts`);
  if (typeof rec["since"] === "string") parts.push(`nothing older than ${rec["since"]}`);
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

function BatchList({ heading, batches, empty, onNavigate }: { heading: string; batches: BatchSummary[]; empty: string; onNavigate: RendererProps["onNavigate"] }) {
  return (
    <Card padding="md">
      <Stack gap="sm">
        <Text as="h2" size="lg" weight="bold">{heading}</Text>
        {batches.length === 0 ? <Text as="p" tone="subtle">{empty}</Text> : (
          <ul className="text-sm">
            {batches.map((b) => (
              <li key={b.id}>
                <Row gap="sm" align="center" wrap>
                  <InlineAction intent="emphatic" onClick={() => onNavigate({ path: `${b.dir}/records.json`, viewer: null, params: {}, viewState: null })}>{b.id}</InlineAction>
                  <Text as="span">{b.records === null ? "records.json unreadable" : `${String(b.records)} records`}</Text>
                  {b.coverage !== null ? (
                    <Text as="span" tone="subtle">scanned {String(b.coverage.scanned)}, stopped: {b.coverage.reason}{b.coverage.stoppedAt !== "" ? ` at ${b.coverage.stoppedAt}` : ""}</Text>
                  ) : null}
                  {b.filed.length > 0 ? <Text as="span" tone="subtle">{String(b.filed.length)} filed</Text> : null}
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </Card>
  );
}
