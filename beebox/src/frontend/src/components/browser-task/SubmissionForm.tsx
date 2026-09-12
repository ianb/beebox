/**
 * SubmissionForm — the shared upload form for any card whose schema declares
 * `submissions`. Built for an agent driving the page first, a person second:
 *
 * - a real `<input type="file" multiple>`, because a browser-automation tool
 *   sets files on the input directly and cannot see a native picker;
 * - the selection ACCUMULATES across change events, because each such set
 *   replaces the input's file list and is capped per call;
 * - validation issues render as plain DOM text, so they can be read back
 *   from the accessibility tree, not only noticed in a toast.
 *
 * The form knows nothing about record shapes: the caller passes `validate`,
 * which runs the same function the server will run at the boundary.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { withBase } from "../../api";
import { withMobileAuth } from "../../lib/mobile-auth";
import { isRecord } from "@shared/is-record";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { InlineAction } from "../ui/InlineAction";

export const MANIFEST_FILE = "records.json";

export interface SubmissionIssue {
  path: string;
  message: string;
}

export type SubmissionValidation = { ok: true; count: number } | { ok: false; issues: SubmissionIssue[] };

export interface SubmissionFormProps {
  /** Box-relative path of the receiving card. */
  cardPath: string;
  /** Runs client-side before upload; the server runs the same check again. */
  validate: (input: { manifest: unknown; fileNames: string[] }) => Promise<SubmissionValidation>;
  /** Disables the form with a reason, e.g. the card is closed or its schema is broken. */
  disabledReason: string | null;
  onAccepted: (result: { batch: string; count: number }) => void;
}

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; percent: number }
  | { phase: "accepted"; batch: string; count: number }
  | { phase: "refused"; message: string; issues: SubmissionIssue[] };

export function SubmissionForm({ cardPath, validate, disabledReason, onAccepted }: SubmissionFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [validation, setValidation] = useState<SubmissionValidation | { ok: false; issues: SubmissionIssue[] } | null>(null);
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length === 0) return;
    setFiles((current) => {
      const byName = new Map(current.map((f) => [f.name, f]));
      for (const f of picked) byName.set(f.name, f);
      return Array.from(byName.values());
    });
    // Clear the input so the same file can be picked again after a Remove,
    // and so the accumulated list, not the input, is the source of truth.
    event.target.value = "";
    setUpload({ phase: "idle" });
  }, []);

  const remove = useCallback((name: string) => {
    setFiles((current) => current.filter((f) => f.name !== name));
    setUpload({ phase: "idle" });
  }, []);

  // Re-validate whenever the selection changes. The manifest must be present
  // and parse as JSON before the schema check runs.
  useEffect(() => {
    let cancelled = false;
    const manifestFile = files.find((f) => f.name === MANIFEST_FILE);
    if (manifestFile === undefined) {
      setValidation(files.length === 0 ? null : { ok: false, issues: [{ path: MANIFEST_FILE, message: `add a ${MANIFEST_FILE} file holding { coverage, records }` }] });
      return;
    }
    void manifestFile.text().then(async (text) => {
      let manifest: unknown;
      try {
        manifest = JSON.parse(text);
      } catch (e: unknown) {
        if (!cancelled) setValidation({ ok: false, issues: [{ path: MANIFEST_FILE, message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] });
        return;
      }
      const result = await validate({ manifest, fileNames: files.filter((f) => f.name !== MANIFEST_FILE).map((f) => f.name) });
      if (!cancelled) setValidation(result);
    });
    return () => {
      cancelled = true;
    };
  }, [files, validate]);

  const submit = useCallback(async () => {
    const manifestFile = files.find((f) => f.name === MANIFEST_FILE);
    if (manifestFile === undefined) return;
    const form = new FormData();
    form.append("card", cardPath);
    form.append("records", manifestFile, MANIFEST_FILE);
    for (const f of files) {
      if (f.name !== MANIFEST_FILE) form.append("files", f, f.name);
    }
    setUpload({ phase: "uploading", percent: 0 });
    const outcome = await postSubmission(form, (percent) => setUpload({ phase: "uploading", percent }));
    setUpload(outcome);
    if (outcome.phase === "accepted") {
      setFiles([]);
      onAccepted({ batch: outcome.batch, count: outcome.count });
    }
  }, [cardPath, files, onAccepted]);

  const canSubmit = disabledReason === null && validation?.ok === true && upload.phase !== "uploading";
  const total = files.reduce((n, f) => n + f.size, 0);

  return (
    <Card padding="md">
      <Stack gap="sm">
        <Text as="h3" weight="semibold">Submit a batch</Text>
        {disabledReason !== null ? <Text as="p" tone="danger">{disabledReason}</Text> : null}
        <label className="block">
          <Text as="span" size="sm">Add files (a {MANIFEST_FILE} plus the files it names; add in several rounds if needed)</Text>
          <input
            ref={inputRef}
            type="file"
            multiple
            disabled={disabledReason !== null}
            onChange={onPick}
            className="mt-1 block w-full text-sm"
          />
        </label>
        {files.length > 0 ? (
          <ul className="text-sm">
            {files.map((f) => (
              <li key={f.name}>
                <Row gap="sm" align="center">
                  <Text as="span" mono>{f.name}</Text>
                  <Text as="span" tone="subtle">{formatBytes(f.size)}</Text>
                  <InlineAction intent="subtle" onClick={() => remove(f.name)}>remove</InlineAction>
                </Row>
              </li>
            ))}
            <li><Text as="span" tone="subtle" size="sm">{String(files.length)} files, {formatBytes(total)}</Text></li>
          </ul>
        ) : null}
        {validation !== null && !validation.ok ? <IssueList heading="Not ready to submit" issues={validation.issues} /> : null}
        {validation?.ok === true && upload.phase === "idle" ? (
          <Text as="p" tone="strong" size="sm">Ready: {String(validation.count)} records validate against the schema.</Text>
        ) : null}
        {upload.phase === "uploading" ? <Text as="p" size="sm">Uploading… {String(upload.percent)}%</Text> : null}
        {upload.phase === "accepted" ? (
          <Text as="p" tone="strong">Accepted batch {upload.batch} with {String(upload.count)} records.</Text>
        ) : null}
        {upload.phase === "refused" ? (
          <Stack gap="xs">
            <Text as="p" tone="danger">Refused: {upload.message}</Text>
            <IssueList heading="Server reported" issues={upload.issues} />
          </Stack>
        ) : null}
        <Row gap="sm">
          <Button intent="primary" disabled={!canSubmit} onClick={submit}>Submit batch</Button>
        </Row>
      </Stack>
    </Card>
  );
}

function IssueList({ heading, issues }: { heading: string; issues: SubmissionIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div>
      <Text as="div" size="sm" weight="semibold" tone="danger">{heading}</Text>
      <ul className="list-disc pl-5 text-sm">
        {issues.map((issue, i) => (
          <li key={`${issue.path}:${String(i)}`}>
            <Text as="span" mono>{issue.path}</Text>: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** POST the multipart body with upload progress; never throws, always resolves to a terminal state. */
function postSubmission(form: FormData, onProgress: (percent: number) => void): Promise<UploadState> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", withBase("/api/cards/submit"));
    const init = withMobileAuth();
    const headers = init.headers;
    if (isRecord(headers)) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") xhr.setRequestHeader(k, v);
      }
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => resolve({ phase: "refused", message: "the connection dropped before the upload finished", issues: [] });
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch (_e) {
        // A non-JSON body (proxy error page) is reported by status alone below.
      }
      if (xhr.status === 200 && isRecord(body) && typeof body["batch"] === "string" && typeof body["count"] === "number") {
        resolve({ phase: "accepted", batch: body["batch"], count: body["count"] });
        return;
      }
      const message = isRecord(body) && typeof body["message"] === "string" ? body["message"] : `HTTP ${String(xhr.status)}`;
      const rawIssues = isRecord(body) && Array.isArray(body["issues"]) ? body["issues"] : [];
      const issues: SubmissionIssue[] = [];
      for (const raw of rawIssues) {
        if (isRecord(raw) && typeof raw["path"] === "string" && typeof raw["message"] === "string") {
          issues.push({ path: raw["path"], message: raw["message"] });
        }
      }
      resolve({ phase: "refused", message, issues });
    };
    xhr.send(form);
  });
}
