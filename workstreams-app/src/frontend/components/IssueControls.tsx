import { useState } from "react";
import { CopyIcon, Pill } from "./ui.js";
import type { Issue, NextAction, Priority } from "../types.js";

const PRIORITIES: Array<{ value: Priority; symbol: string; label: string }> = [{ value: "important", symbol: "!", label: "Important" }, { value: "normal", symbol: "−", label: "Normal" }, { value: "backlog", symbol: "↓", label: "Backlog" }, { value: "uncategorized", symbol: "?", label: "Uncategorized" }];
function nextActionFrom(value: string): NextAction | undefined {
  return value === "reconfirm" || value === "duplicate" || value === "invalid" || value === "fixed" ? value : undefined;
}

export function PriorityControls({ value, onChange }: { value: Priority; onChange: (value: Priority) => void }) {
  return <div className="priority-controls" role="radiogroup" aria-label="Issue priority">{PRIORITIES.map((priority) => <button type="button" key={priority.value} data-priority={priority.value} className={value === priority.value ? "active" : ""} role="radio" aria-checked={value === priority.value} aria-label={priority.label} title={priority.label} onClick={() => onChange(priority.value)}>{priority.symbol}</button>)}</div>;
}

export function NextActionSelect({ value, onChange }: { value?: NextAction | undefined; onChange: (value?: NextAction | undefined) => void }) {
  return <select className="next-action" value={value ?? ""} aria-label="Next action" onChange={(event) => onChange(nextActionFrom(event.target.value))}><option value="">Next action…</option><option value="reconfirm">Reconfirm?</option><option value="duplicate">Dup?</option><option value="invalid">Invalid?</option><option value="fixed">Fixed?</option></select>;
}

export function IssueTags({ issue }: { issue: Issue }) {
  const tags = [
    ...issue.frontmatter.needs.toSorted((a, b) => Number(b === "manual-testing") - Number(a === "manual-testing")).map((need) => <Pill tone={need === "manual-testing" ? "manual" : "neutral"} key={`need-${need}`}>needs:{need}</Pill>),
    issue.frontmatter.area ? <Pill key="area">{issue.frontmatter.area}</Pill> : null,
    ...issue.frontmatter.labels.map((label) => <Pill tone="accent" key={`label-${label}`}>{label}</Pill>),
    issue.frontmatter.filedBy ? <Pill key="filed">filed:{issue.frontmatter.filedBy}</Pill> : null,
    issue.frontmatter.discoveredBy ? <Pill key="discoverer">discovered:{issue.frontmatter.discoveredBy}</Pill> : null,
  ];
  return <div className="issue-tags">{tags}</div>;
}

export function CopyIssuePath({ issue }: { issue: Issue }) {
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  const path = `${issue.visibility === "private" ? "private-issues" : "issues"}/${issue.relPath}`;
  async function copy() { try { await navigator.clipboard.writeText(path); setResult("copied"); } catch (_error) { setResult("failed"); } window.setTimeout(() => setResult("idle"), 1500); }
  return <button type="button" className={`copy-issue-path ${result}`} aria-label={`Copy ${path}`} title={result === "copied" ? "Copied" : `Copy ${path}`} onClick={() => void copy()}><CopyIcon /></button>;
}
