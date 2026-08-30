import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface JsonViewProps {
  /** Any JSON-serializable value. Objects render as key/value pairs, arrays as indexed lists. */
  value: unknown;
  /** Outer-layout classes (margin, padding, sizing, position). */
  className?: string;
}

/**
 * Human-friendly JSON renderer. Keys label their values, which are indented below
 * and rendered recursively. Strings keep their whitespace and wrap on any character
 * (so long paths/filenames break sensibly); numbers, booleans, and null are shown via
 * JSON.stringify in a distinct color.
 */
export function JsonView({ value, className }: JsonViewProps) {
  return (
    <div className={cn("font-mono text-[11px] leading-snug", className)}>
      <JsonNode value={value} />
    </div>
  );
}

/**
 * TS types `JSON.stringify` as always returning `string`, but at runtime it
 * returns `undefined` for an `undefined` input — a known gap in the lib types.
 * The cast makes that possibility honest for the one caller (a bare scalar
 * fallback) that can actually hit it. Takes `unknown` because TS can't narrow
 * a plain `unknown` value down to a smaller union by negation (unlike a real
 * union type), so the caller's typeof/Array.isArray checks don't narrow it
 * for us here.
 */
// TS types `JSON.stringify` as always returning `string`, but at runtime it
// returns `undefined` for an `undefined` input. Declaring the honest return
// type on this one-line wrapper (rather than casting at the call site) means
// the caller sees `string | undefined` without narrowing across the call.
function stringifyOrUndefined(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function stringifyScalar(value: unknown): string {
  return stringifyOrUndefined(value) ?? "undefined";
}

function JsonNode({ value }: { value: unknown }): ReactNode {
  if (typeof value === "string") {
    return <span className="whitespace-pre-wrap break-all text-warm-800">{value}</span>;
  }
  if (Array.isArray(value)) {
    return <JsonArray items={value} />;
  }
  if (value !== null && typeof value === "object") {
    return <JsonObject entries={Object.entries(value)} />;
  }
  // number | boolean | null | undefined — show literally, colored apart from strings.
  return <span className="text-info-dark break-all">{stringifyScalar(value)}</span>;
}

function JsonObject({ entries }: { entries: [string, unknown][] }) {
  if (entries.length === 0) {
    return <span className="text-info-dark">{"{}"}</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([key, val]) => (
        <div key={key}>
          <div className="text-warm-600 font-medium break-all">{key}:</div>
          <div className="pl-3">
            <JsonNode value={val} />
          </div>
        </div>
      ))}
    </div>
  );
}

function JsonArray({ items }: { items: unknown[] }) {
  if (items.length === 0) {
    return <span className="text-info-dark">[]</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item, i) => (
        // Index hangs to the left; wrapped value lines align under the value, not the index.
        <div key={i} className="flex gap-1.5">
          <span className="shrink-0 tabular-nums text-warm-400">{i}:</span>
          <div className="min-w-0 flex-1">
            <JsonNode value={item} />
          </div>
        </div>
      ))}
    </div>
  );
}
