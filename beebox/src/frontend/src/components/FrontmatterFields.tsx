import { createContext, useContext, useMemo } from "react";
import { resolveRelativePath } from "../lib/view-url";
import { isRecord } from "@shared/is-record";
import { toDisplayPath } from "@shared/display-path";
import { TodosFieldSchema, type TodoEntry } from "@shared/todo-model";
import { TodoItem } from "./todo/TodoItem";
import { hiddenInReading } from "./todo/todo-item-logic";
import { usePlateState } from "./todo/card-todos-context";
import type { ReactNode } from "react";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

interface FieldsNavCtx {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath: string | undefined;
}
const FieldsNavContext = createContext<FieldsNavCtx | null>(null);

type Scalar = string | number | boolean | null;

function isScalar(value: unknown): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function formatScalar(value: Scalar): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function hasRef(value: unknown): value is { ref: string } {
  return isRecord(value) && typeof value.ref === "string";
}

function RefLink({ refPath }: { refPath: string }): ReactNode {
  const nav = useContext(FieldsNavContext);
  const noFrag = refPath.split("#")[0] ?? refPath;
  const resolved = nav === null ? null : resolveRelativePath(nav.basePath, noFrag);
  const displayPath = toDisplayPath(refPath);
  if (nav === null || resolved === null) {
    return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{displayPath}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => nav.onNavigate({ path: resolved, viewer: null, params: {}, viewState: null }, { label: refPath })}
      className="bbx-theme-link max-w-full cursor-pointer whitespace-pre-wrap text-left [overflow-wrap:anywhere]"
    >
      {displayPath}
    </button>
  );
}

/** An http(s) scalar renders as a real link — an `href:` shown as inert text
 *  is a dead end the reader has to copy by hand (boxholder, 2026-08-29). */
function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/.test(value);
}

function ValueView({ value }: { value: unknown }): ReactNode {
  if (isHttpUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
      className="bbx-theme-link [overflow-wrap:anywhere]"
      >
        {value}
      </a>
    );
  }
  if (isScalar(value)) {
    return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{formatScalar(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-warm-500 italic">empty</span>;
    if (value.every(isScalar)) {
      return (
        <ul className="min-w-0 list-disc list-outside ml-5 space-y-0.5 marker:text-warm-400">
          {value.map((item, index) => <li key={index} className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{formatScalar(item)}</li>)}
        </ul>
      );
    }
    return (
      <ol className="min-w-0 list-decimal list-outside ml-5 marker:text-warm-400 divide-y divide-warm-400 [&>li]:min-w-0 [&>li]:py-2 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
        {value.map((item, index) => <li key={index}><ValueView value={item} /></li>)}
      </ol>
    );
  }
  if (hasRef(value) && Object.keys(value).length === 1) return <RefLink refPath={value.ref} />;
  if (isRecord(value)) return <FieldsTable fields={value} root={false} />;
  return null;
}

/** One `todos:` entry, addressed as the collector addresses it (`{ kind: "frontmatter", index }`). */
function FrontmatterTodo({ entry, index }: { entry: TodoEntry; index: number }): ReactNode {
  const nav = useContext(FieldsNavContext);
  const cardPath = nav?.basePath ?? null;
  const locator = { kind: "frontmatter" as const, index };
  const plateState = usePlateState(cardPath, locator);
  return (
    <li className="min-w-0">
      <TodoItem
        status={entry.status ?? "open"}
        assigned={entry.assigned}
        due={entry.due}
        start={entry.start}
        plateState={plateState}
        layout="line"
        locator={locator}
        cardPath={cardPath}
        text={entry.text}
        muted={false}
      >
        {entry.text}
      </TodoItem>
    </li>
  );
}

/**
 * A card's own `todos:` list, rendered as todos (`docs/plans/todos-ui.md`,
 * Track 2) rather than as `text:`/`due:` rows. `null` when the value is not a
 * valid todo list, so it falls back to the generic rendering — the collector
 * reads nothing from an invalid list either (`core/todo/extract.ts`).
 */
function visibleTodoEntries(value: unknown): Array<{ entry: TodoEntry; index: number }> | null {
  const parsed = TodosFieldSchema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) return null;
  return parsed.data
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !hiddenInReading({ status: entry.status ?? "open", assigned: entry.assigned }));
}

function FieldRow({ name, value, root }: { name: string; value: unknown; root: boolean }): ReactNode {
  const todos = root && name === "todos" ? visibleTodoEntries(value) : null;
  // Every entry a finished agent follow-up: nothing for the reader here.
  if (todos !== null && todos.length === 0) return null;
  return (
    <div className="contents">
      <dt className="min-w-0 max-w-32 text-warm-500 text-right whitespace-pre-wrap [overflow-wrap:anywhere] bbx-card-field-label">{name}:</dt>
      <dd className="min-w-0 max-w-full">
        {todos !== null ? (
          <ul className="min-w-0 space-y-1">
            {todos.map(({ entry, index }) => <FrontmatterTodo key={index} entry={entry} index={index} />)}
          </ul>
        ) : name === "ref" && typeof value === "string" ? <RefLink refPath={value} /> : <ValueView value={value} />}
      </dd>
    </div>
  );
}

function FieldsTable({ fields, root }: { fields: Record<string, unknown>; root: boolean }): ReactNode {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <dl className="min-w-0 max-w-full grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm text-warm-800 bbx-card-fields">
      {entries.map(([name, value]) => <FieldRow key={name} name={name} value={value} root={root} />)}
    </dl>
  );
}

export function FrontmatterFields({ fields, onNavigate, basePath }: {
  fields: Record<string, unknown>;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath: string | undefined;
}): ReactNode {
  const navCtx = useMemo<FieldsNavCtx>(() => ({ onNavigate, basePath }), [onNavigate, basePath]);
  return <FieldsNavContext.Provider value={navCtx}><FieldsTable fields={fields} root /></FieldsNavContext.Provider>;
}
