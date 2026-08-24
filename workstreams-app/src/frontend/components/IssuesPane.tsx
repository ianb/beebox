import { useEffect, useRef } from "react";
import type { Ref } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { CopyIssuePath, IssueTags, NextActionSelect, PriorityControls } from "./IssueControls.js";
import { IssueCategoryNav } from "./IssueCategoryNav.js";
import { Markdown } from "./Markdown.js";
import { Button, Pill } from "./ui.js";
import { trpc } from "../trpc.js";
import { issueCategoryId } from "../lib/issue-category-nav.js";
import type { Issue, IssueChange, NextAction, Priority, Visibility } from "../types.js";

export interface IssueFilters {
  status?: "open" | "closed" | "all" | undefined;
  sort?: "date" | "priority" | undefined;
  category?: string | undefined;
  priority?: Priority | undefined;
  needs?: string | undefined;
}

type IssueSearch = IssueFilters & {
  issue?: string | undefined;
  issueVisibility?: Visibility | undefined;
};

export function issuePassesStatusFilter(issue: Pick<Issue, "closed">, filter: { status: IssueFilters["status"]; selected: boolean }): boolean {
  const { status, selected } = filter;
  if (status === "all") return true;
  if (status === "closed") return issue.closed;
  if (status === "open") return !issue.closed;
  return selected || !issue.closed;
}

export function issueChangeKey(issue: Pick<Issue, "relPath" | "visibility">): string {
  return `${issue.visibility}:${issue.relPath}`;
}

const PRIORITY_ORDER: Record<Priority, number> = {
  important: 0,
  normal: 1,
  uncategorized: 2,
  backlog: 3,
};

function isPriority(value: unknown): value is Priority {
  return value === "important" || value === "normal" || value === "backlog" || value === "uncategorized";
}

function asFilters(search: Record<string, unknown>): IssueSearch {
  return {
    ...(search.status === "open" || search.status === "closed" || search.status === "all" ? { status: search.status } : {}),
    ...(search.sort === "date" || search.sort === "priority" ? { sort: search.sort } : {}),
    ...(typeof search.category === "string" ? { category: search.category } : {}),
    ...(isPriority(search.priority) ? { priority: search.priority } : {}),
    ...(typeof search.needs === "string" ? { needs: search.needs } : {}),
    ...(typeof search.issue === "string" ? { issue: search.issue } : {}),
    ...(search.issueVisibility === "public" || search.issueVisibility === "private" ? { issueVisibility: search.issueVisibility } : {}),
  };
}

function issueDate(issue: Issue): string {
  return issue.slug.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function editedChange(issue: Issue, values: { priority: Priority; nextAction?: NextAction | undefined }): IssueChange {
  return {
    relPath: issue.relPath,
    visibility: issue.visibility,
    originalPriority: issue.frontmatter.priority,
    originalNextAction: issue.frontmatter.nextAction ?? null,
    priority: values.priority,
    nextAction: values.nextAction ?? null,
  };
}

function FilterMenu({ filters, categories, needs, onFilters }: { filters: IssueFilters; categories: string[]; needs: string[]; onFilters: (filters: IssueFilters) => void }) {
  function without(field: "category" | "priority" | "needs"): IssueFilters {
    const { [field]: _removed, ...remaining } = filters;
    return remaining;
  }
  function setStatus(value: string): void {
    if (value === "open" || value === "closed" || value === "all") onFilters({ ...filters, status: value });
  }
  function setSort(value: string): void {
    if (value === "date" || value === "priority") onFilters({ ...filters, sort: value });
  }
  return <details className="filter-menu"><summary>Filter</summary><div className="filter-popover">
    <label>Status <select value={filters.status ?? "open"} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="all">All</option><option value="closed">Closed</option></select></label>
    <label>Sort <select value={filters.sort ?? "date"} onChange={(event) => setSort(event.target.value)}><option value="date">Newest filed</option><option value="priority">Priority</option></select></label>
    <label>Category <select value={filters.category ?? ""} onChange={(event) => onFilters(event.target.value ? { ...filters, category: event.target.value } : without("category"))}><option value="">Every category</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
    <label>Priority <select value={filters.priority ?? ""} onChange={(event) => onFilters(isPriority(event.target.value) ? { ...filters, priority: event.target.value } : without("priority"))}><option value="">Any priority</option><option value="important">Important</option><option value="normal">Normal</option><option value="backlog">Backlog</option><option value="uncategorized">Uncategorized</option></select></label>
    <label>Needs <select value={filters.needs ?? ""} onChange={(event) => onFilters(event.target.value ? { ...filters, needs: event.target.value } : without("needs"))}><option value="">Every need</option>{needs.map((need) => <option value={need} key={need}>{need}</option>)}</select></label>
  </div></details>;
}

function IssueRow({ issue, selected, change, rowRef, onSelect, onChange }: { issue: Issue; selected: boolean; change?: IssueChange | undefined; rowRef?: Ref<HTMLLIElement> | undefined; onSelect: () => void; onChange: (change: IssueChange) => void }) {
  const priority = change?.priority ?? issue.frontmatter.priority;
  const nextAction = change ? change.nextAction ?? undefined : issue.frontmatter.nextAction;
  return <li className={selected ? "selected" : ""} ref={rowRef}><div className="issue-title-row"><button type="button" className="issue-title" onClick={onSelect}>{issue.frontmatter.title}</button><CopyIssuePath issue={issue} /></div><span className="issue-meta">{issueDate(issue)} · {issue.slug.replace(/^\d{4}-\d{2}-\d{2}-?/, "")}</span><div className="issue-actions-row"><IssueTags issue={issue} /><div className="issue-edit-controls"><PriorityControls value={priority} onChange={(value) => onChange(editedChange(issue, { priority: value, nextAction }))} /><NextActionSelect value={nextAction} onChange={(value) => onChange(editedChange(issue, { priority, nextAction: value }))} /></div></div></li>;
}

function LoadedIssueDetail({ issue, onBack }: { issue: Issue; onBack: () => void }) {
  const detail = trpc.issues.detail.useQuery({ relPath: issue.relPath, visibility: issue.visibility });
  const value = detail.data ?? issue;
  return <aside className="issue-detail"><Button className="mobile-back" onClick={onBack}>← Issues</Button><header><h2 className="issue-detail-title">{value.frontmatter.title}</h2><p className="issue-meta">{value.relPath} · {value.closed ? "Closed" : "Open"}</p><IssueTags issue={value} /></header>{detail.isLoading ? <section className="loading-skeleton" aria-busy="true"><span /></section> : detail.isError ? <section className="error-state"><p>Couldn’t load details: {detail.error.message}</p><Button onClick={() => void detail.refetch()}>Retry</Button></section> : value.body ? <article className="issue-body"><Markdown source={value.body} /></article> : <p className="muted">No issue details found.</p>}</aside>;
}

function IssueDetail({ issue, onBack }: { issue?: Issue | undefined; onBack: () => void }) {
  return issue ? <LoadedIssueDetail issue={issue} onBack={onBack} /> : <aside className="issue-detail empty-detail"><p>Select an issue to inspect its details.</p></aside>;
}

export function IssuesPane({ issues, changes, saving, onReset, onSave, onChange }: { issues: Issue[]; changes: Map<string, IssueChange>; saving: boolean; onReset: () => void; onSave: () => void; onChange: (change: IssueChange) => void }) {
  const listPaneRef = useRef<HTMLElement>(null);
  const selectedRowRef = useRef<HTMLLIElement>(null);
  const search = asFilters(useSearch({ strict: false }));
  const navigate = useNavigate();
  const selected = issues.find((issue) => issue.relPath === search.issue && issue.visibility === (search.issueVisibility ?? "public"));
  const categories = [...new Set(issues.map((issue) => issue.category))].toSorted();
  const needs = [...new Set(issues.flatMap((issue) => issue.frontmatter.needs))].toSorted();
  const visible = issues.filter((issue) => issuePassesStatusFilter(issue, { status: search.status, selected: selected === issue })).filter((issue) => !search.category || issue.category === search.category).filter((issue) => !search.needs || issue.frontmatter.needs.includes(search.needs)).filter((issue) => !search.priority || (changes.get(issueChangeKey(issue))?.priority ?? issue.frontmatter.priority) === search.priority).toSorted((a, b) => search.sort === "priority" ? PRIORITY_ORDER[changes.get(issueChangeKey(a))?.priority ?? a.frontmatter.priority] - PRIORITY_ORDER[changes.get(issueChangeKey(b))?.priority ?? b.frontmatter.priority] || b.slug.localeCompare(a.slug) : b.slug.localeCompare(a.slug));
  const selectedKey = selected ? issueChangeKey(selected) : null;
  const selectedVisibleIndex = selectedKey ? visible.findIndex((issue) => issueChangeKey(issue) === selectedKey) : -1;
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [selectedKey, selectedVisibleIndex]);
  const byCategory = new Map<string, Issue[]>();
  for (const issue of visible) {
    const records = byCategory.get(issue.category) ?? [];
    records.push(issue);
    byCategory.set(issue.category, records);
  }
  function setFilters(next: IssueFilters): void { void navigate({ to: "/issues", search: { ...next, ...(search.issue ? { issue: search.issue, issueVisibility: search.issueVisibility ?? "public" } : {}) } }); }
  function select(issue: Issue): void { void navigate({ to: "/issues", search: { ...search, issue: issue.relPath, issueVisibility: issue.visibility } }); }
  function back(): void { void navigate({ to: "/issues", search: { ...search, issue: undefined, issueVisibility: undefined } }); }
  return <main className="issues-page"><header className="issues-header"><div className="issue-breadcrumb"><a href="/">/</a><Link to="/">workstreams</Link><span>/</span><h1>issues</h1></div><FilterMenu filters={search} categories={categories} needs={needs} onFilters={setFilters} /><div className="active-filters">{search.status && search.status !== "open" ? <Pill>{`status: ${search.status}`}</Pill> : null}{search.sort === "priority" ? <Pill>sort: priority</Pill> : <Pill>sort: newest filed</Pill>}{search.category ? <Pill>{`category: ${search.category}`}</Pill> : null}{search.priority ? <Pill>{`priority: ${search.priority}`}</Pill> : null}{search.needs ? <Pill tone={search.needs === "manual-testing" ? "manual" : "neutral"}>{`needs: ${search.needs}`}</Pill> : null}</div><div className="issue-save-actions"><span>{saving ? "Saving issue changes…" : `${changes.size} unsaved issue${changes.size === 1 ? "" : "s"}`}</span><Button disabled={changes.size === 0 || saving} onClick={onReset}>Reset</Button><Button intent="primary" disabled={changes.size === 0 || saving} onClick={onSave}>{saving ? "Saving…" : "Save"}</Button></div></header><div className="issue-browser"><section className="issue-list-pane" aria-label="Issues" ref={listPaneRef}>{visible.length > 0 ? <><IssueCategoryNav categories={[...byCategory.entries()].map(([name, records]) => ({ name, count: records.length }))} scrollRoot={listPaneRef} />{[...byCategory.entries()].map(([category, records]) => <section className="issue-category" id={issueCategoryId(category)} data-issue-category={category} tabIndex={-1} key={category}><h2 className="issue-category-heading">{category} <small>{records.length}</small></h2><ul className="issue-list">{records.map((issue) => { const key = issueChangeKey(issue); const isSelected = selectedKey === key; return <IssueRow key={key} issue={issue} selected={isSelected} change={changes.get(key)} rowRef={isSelected ? selectedRowRef : undefined} onSelect={() => select(issue)} onChange={onChange} />; })}</ul></section>)}</> : <p className="empty-state">No issues match these filters.</p>}</section><IssueDetail issue={selected} onBack={back} /></div></main>;
}
