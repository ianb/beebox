/**
 * MarkdownCardView — default viewer for Phase 2 (YAML frontmatter + markdown
 * body) cards.
 *
 * Frontmatter renders as a key/value table at the top level. Scalar fields
 * occupy a single row; long-string fields take a value cell that wraps;
 * arrays and objects render recursively inside the value cell.
 *
 * The markdown body is rendered via the shared `<Markdown>` component, so
 * view:/relative links resolve the same way as for `.md` files.
 */

import { Markdown } from "./Markdown";
import type { RendererProps } from "../renderers";
import type { ReactNode } from "react";

type Scalar = string | number | boolean | null;

function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function formatScalar(v: Scalar): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * Render an arbitrary value (the right-hand side of a key/value row, or the
 * content of a list item). Scalars render inline; objects render as a nested
 * key/value table; arrays render as a list.
 */
function ValueView({ value }: { value: unknown }): ReactNode {
  if (isScalar(value)) {
    return <span className="whitespace-pre-wrap break-words">{formatScalar(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-warm-500 italic">empty</span>;
    }
    const allScalar = value.every(isScalar);
    if (allScalar) {
      return (
        <ul className="list-disc list-inside space-y-0.5">
          {value.map((item, i) => (
            <li key={i}>{formatScalar(item as Scalar)}</li>
          ))}
        </ul>
      );
    }
    return (
      <ol className="list-decimal list-outside ml-5 space-y-2 marker:text-warm-400">
        {value.map((item, i) => (
          <li key={i}>
            <ValueView value={item} />
          </li>
        ))}
      </ol>
    );
  }
  if (value !== null && typeof value === "object") {
    return <FieldsTable fields={value as Record<string, unknown>} />;
  }
  return null;
}

/**
 * Two-column key/value table. The key column is right-aligned and sized to
 * content; the value column takes the remaining width.
 */
function FieldsTable({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm text-warm-800">
      {entries.map(([key, value]) => (
        <FieldRow key={key} name={key} value={value} />
      ))}
    </dl>
  );
}

function FieldRow({ name, value }: { name: string; value: unknown }) {
  return (
    <>
      <dt className="text-warm-500 text-right whitespace-nowrap">{name}</dt>
      <dd className="min-w-0">
        <ValueView value={value} />
      </dd>
    </>
  );
}

export function MarkdownCardView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter;
  const body = data.body;

  return (
    <div className="p-4 max-w-3xl">
      {frontmatter !== undefined && Object.keys(frontmatter).length > 0 ? (
        <div className="mb-4 pb-3 border-b border-warm-200">
          <FieldsTable fields={frontmatter} />
        </div>
      ) : null}

      {body !== undefined && body.trim() !== "" ? (
        <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>
          {body}
        </Markdown>
      ) : (
        <div className="text-sm text-warm-500 italic">No body content</div>
      )}
    </div>
  );
}
