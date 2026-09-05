import { createContext, useContext, useMemo } from "react";
import { resolveRelativePath } from "../lib/view-url";
import { isRecord } from "@shared/is-record";
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
  if (nav === null || resolved === null) {
    return <span className="whitespace-pre-wrap break-words">{refPath}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => nav.onNavigate({ path: resolved, viewer: null, params: {}, viewState: null }, { label: refPath })}
      className="text-warm-600 hover:text-warm-800 underline-offset-2 hover:underline cursor-pointer break-words text-left"
    >
      {refPath}
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
        className="text-warm-600 hover:text-warm-800 underline underline-offset-2 break-all"
      >
        {value}
      </a>
    );
  }
  if (isScalar(value)) {
    return <span className="whitespace-pre-wrap break-words">{formatScalar(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-warm-500 italic">empty</span>;
    if (value.every(isScalar)) {
      return (
        <ul className="list-disc list-outside ml-5 space-y-0.5 marker:text-warm-400">
          {value.map((item, index) => <li key={index}>{formatScalar(item)}</li>)}
        </ul>
      );
    }
    return (
      <ol className="list-decimal list-outside ml-5 marker:text-warm-400 divide-y divide-warm-400 [&>li]:py-2 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
        {value.map((item, index) => <li key={index}><ValueView value={item} /></li>)}
      </ol>
    );
  }
  if (hasRef(value) && Object.keys(value).length === 1) return <RefLink refPath={value.ref} />;
  if (isRecord(value)) return <FieldsTable fields={value} />;
  return null;
}

function FieldsTable({ fields }: { fields: Record<string, unknown> }): ReactNode {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm text-warm-800">
      {entries.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-warm-500 text-right whitespace-nowrap">{name}:</dt>
          <dd className="min-w-0">
            {name === "ref" && typeof value === "string" ? <RefLink refPath={value} /> : <ValueView value={value} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FrontmatterFields({ fields, onNavigate, basePath }: {
  fields: Record<string, unknown>;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath: string | undefined;
}): ReactNode {
  const navCtx = useMemo<FieldsNavCtx>(() => ({ onNavigate, basePath }), [onNavigate, basePath]);
  return <FieldsNavContext.Provider value={navCtx}><FieldsTable fields={fields} /></FieldsNavContext.Provider>;
}
