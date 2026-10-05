import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, CopyIcon, Pill } from "../ui.js";
import { issueNextActionSchema } from "../../../shared/documents.js";
import { issueProvenance } from "../../../shared/issue-provenance.js";
import { trpc } from "../../trpc.js";
import type { Issue, NextAction, NextActionState, Priority } from "../../types.js";

const PRIORITIES: Array<{ value: Priority; symbol: string; label: string }> = [{ value: "important", symbol: "!", label: "Important" }, { value: "normal", symbol: "−", label: "Normal" }, { value: "backlog", symbol: "↓", label: "Backlog" }, { value: "uncategorized", symbol: "?", label: "Uncategorized" }];
export const ISSUE_NEXT_ACTION_OPTIONS: Array<{ value: NextAction; label: string }> = [{ value: "discuss", label: "Discuss" }, { value: "reconfirm", label: "Reconfirm?" }, { value: "duplicate", label: "Dup?" }, { value: "invalid", label: "Invalid?" }, { value: "fixed", label: "Fixed?" }, { value: "manually-confirmed", label: "Manually confirmed" }, { value: "verify-without-me", label: "Verify without me" }, { value: "do-it", label: "Just do it" }];
function nextActionFrom(value: string): NextAction | undefined {
  const parsed = issueNextActionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function PriorityControls({ value, onChange }: { value: Priority; onChange: (value: Priority) => void }) {
  return <div className="priority-controls" role="radiogroup" aria-label="Issue priority">{PRIORITIES.map((priority) => <button type="button" key={priority.value} data-priority={priority.value} className={value === priority.value ? "active" : ""} role="radio" aria-checked={value === priority.value} aria-label={priority.label} title={priority.label} onClick={() => onChange(priority.value)}>{priority.symbol}</button>)}</div>;
}

/** The select's own value for "write a message"; never stored. */
const MESSAGE_OPTION = "message";

/**
 * The developer's request to the issue picker. Unlike priority, it is not
 * staged behind Save: each choice is written to the local next-action store
 * at once, and nothing reaches git. "Message…" opens a text field; Enter saves
 * the text next to whatever action is set, Escape abandons it.
 *
 * One hook, two pieces: the select sits with the row's other controls and the
 * message gets a full-width line of its own below them.
 */
export function useNextAction(issue: Issue) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<string | null>(null);
  const update = trpc.issues.setNextAction.useMutation({
    onSuccess: ({ nextAction }) => {
      utils.issues.list.setData(undefined, (current) => current && {
        items: current.items.map((item) => {
          if (item.visibility !== issue.visibility || item.slug !== issue.slug) return item;
          const { nextAction: _previous, ...rest } = item;
          return nextAction ? { ...rest, nextAction } : rest;
        }),
      });
      setDraft(null);
    },
  });
  const pending = update.isPending ? update.variables : undefined;
  const current: Partial<NextActionState> = pending
    ? { ...(pending.action ? { action: pending.action } : {}), ...(pending.message ? { message: pending.message } : {}) }
    : issue.nextAction ?? {};
  function save(action: NextAction | null, message: string | null): void {
    // Not disabling the controls while a save is in flight keeps keyboard
    // focus where it is; a second change waits for the first instead.
    if (update.isPending) return;
    update.mutate({ visibility: issue.visibility, slug: issue.slug, action, message });
  }
  function choose(value: string): void {
    if (value === MESSAGE_OPTION) { setDraft(current.message ?? ""); return; }
    // The blank choice withdraws the whole request, message included.
    const action = nextActionFrom(value) ?? null;
    save(action, action === null ? null : current.message ?? null);
  }
  return {
    current, draft, setDraft, choose,
    submit: (message: string) => save(current.action ?? null, message),
    error: update.isError ? update.error.message : null,
  };
}

export type NextActionModel = ReturnType<typeof useNextAction>;

export function NextActionSelect({ model }: { model: NextActionModel }) {
  const { current, choose } = model;
  return <select className="next-action" value={current.action ?? ""} aria-label="Next action" onChange={(event) => choose(event.target.value)}><option value="">Next action…</option>{ISSUE_NEXT_ACTION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}<option value={MESSAGE_OPTION}>{current.message ? "Edit message…" : "Message…"}</option></select>;
}

export function NextActionMessage({ model }: { model: NextActionModel }) {
  const { current, draft, setDraft, submit, error } = model;
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // Choosing "Message…" is a request to type, so the field takes focus; when
  // the field closes, focus returns to the message rather than the page body.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (wasEditing.current) messageRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") { event.preventDefault(); submit(event.currentTarget.value); }
    if (event.key === "Escape") { event.preventDefault(); setDraft(null); }
  }
  const body = draft === null
    ? current.message ? <button type="button" ref={messageRef} className="next-action-message" title="Edit message" onClick={() => setDraft(current.message ?? "")}>“{current.message}”</button> : null
    : <input ref={inputRef} className="next-action-message-input" aria-label="Next action message" placeholder="Message for the picker; Enter saves, Escape cancels" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} />;
  if (body === null && error === null) return null;
  return <div className="next-action-note">{body}{error === null ? null : <span className="next-action-error" role="alert">Couldn’t save: {error}</span>}</div>;
}

export function IssueTags({ issue }: { issue: Issue }) {
  const provenance = issueProvenance(issue.frontmatter.discoveredIn);
  const discoveredBy = issue.frontmatter.discoveredBy;
  const tags = [
    ...issue.frontmatter.needs.toSorted((a, b) => Number(b === "manual-testing") - Number(a === "manual-testing")).map((need) => <Pill tone={need === "manual-testing" ? "manual" : "neutral"} key={`need-${need}`}>needs:{need}</Pill>),
    issue.frontmatter.area ? <Pill key="area">{issue.frontmatter.area}</Pill> : null,
    ...issue.frontmatter.labels.map((label) => <Pill tone="accent" key={`label-${label}`}>{label}</Pill>),
    issue.frontmatter.filedBy ? <Pill key="filed">filed:{issue.frontmatter.filedBy}</Pill> : null,
    // WHERE it was noticed, which is the half that helps route or judge an issue.
    // The context clause is a sentence and is shown in the detail pane instead;
    // here it is the pill's tooltip so a scan can still reach it.
    provenance ? <Pill key="from" title={provenance.context ?? undefined}>from:{provenance.source}</Pill> : null,
    // Who found it, but only when that says something: `agent` duplicates the
    // `filed:agent` pill sitting next to it, and a queue of `discovered:agent`
    // was what hid the provenance above.
    discoveredBy !== undefined && discoveredBy !== "agent" ? <Pill key="discoverer">discovered:{discoveredBy}</Pill> : null,
  ];
  return <div className="issue-tags">{tags}</div>;
}

export function CopyIssuePath({ issue }: { issue: Issue }) {
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  const path = `${issue.visibility === "private" ? "private-issues" : "issues"}/${issue.relPath}`;
  async function copy() { try { await navigator.clipboard.writeText(path); setResult("copied"); } catch (_error) { setResult("failed"); } window.setTimeout(() => setResult("idle"), 1500); }
  const copied = result === "copied";
  return <button type="button" className={`copy-issue-path ${result}`} aria-label={copied ? `Copied ${path}` : `Copy ${path}`} title={copied ? "Copied!" : `Copy ${path}`} aria-live="polite" onClick={() => void copy()}>{copied ? <CheckIcon /> : <CopyIcon />}</button>;
}
