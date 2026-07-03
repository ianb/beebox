/**
 * Named builtin views — self-sufficient interface surfaces a `view` card
 * can point at (docs/plans/interface-as-cards.md, "instrument cards").
 * The card supplies the address, configuration (`params`), and notes; the
 * view brings its own data.
 *
 * Single source for schema validation (src/schemas/view.ts) and the
 * frontend component registry (src/frontend/src/renderers/view.tsx) —
 * keep the registry in sync when adding a name here.
 */

import { z } from "zod";

/**
 * Where a resolved param value came from. Open-ended by design — an
 * embed-site origin joins when transclusion passes params. Consumers:
 * the shell's "modified from card" marker, views that treat recorded vs
 * injected params as different in kind, and the agent-facing activity
 * snapshot (which must not misattribute an override to the card).
 */
export type ParamOrigin = "card" | "url";

/**
 * The one shape views receive params in — merged values plus per-key
 * provenance, with the card layer retained so consumers can diff an
 * adjusted state against the card (emitting overrides only for keys that
 * actually differ) and reset back to it.
 */
export interface ResolvedViewParams {
  values: Record<string, unknown>;
  origins: Record<string, ParamOrigin>;
  /** The card-frontmatter layer alone (pre-overlay). */
  card: Record<string, unknown>;
}

/**
 * params ↔ query-string codec for a parameterized view. `fromQuery` reads
 * only the keys it declares (renderer plumbing injects extras like `path`);
 * lists ride as comma-separated values, booleans as `true`/`false` (an
 * explicit `false` can override a card's `true`).
 */
export interface ViewQueryCodec {
  fromQuery(query: Record<string, string>): Record<string, unknown>;
  toQuery(values: Record<string, unknown>): Record<string, string>;
}

export interface NamedView {
  name: string;
  description: string;
  /**
   * Frontmatter `params` shape for this view. Absent means the view takes
   * no params (a card supplying any is a validation error). `.strict()`
   * so misspelled keys fail loudly instead of silently doing nothing.
   */
  params?: z.ZodType;
  /** Query-string overrides for `params`; absent means URL params are ignored. */
  query?: ViewQueryCodec;
}

/**
 * The param cascade, merged with provenance: card frontmatter, then URL
 * query overrides per key. The single assembly point — views never read
 * the URL themselves, or configuration becomes unattributable.
 */
export function resolveViewParams(input: {
  card?: Record<string, unknown>;
  query?: Record<string, string>;
  codec?: ViewQueryCodec;
}): ResolvedViewParams {
  const card = input.card ?? {};
  const values: Record<string, unknown> = {};
  const origins: Record<string, ParamOrigin> = {};
  for (const [key, value] of Object.entries(card)) {
    values[key] = value;
    origins[key] = "card";
  }
  const overrides = input.codec && input.query ? input.codec.fromQuery(input.query) : {};
  for (const [key, value] of Object.entries(overrides)) {
    values[key] = value;
    origins[key] = "url";
  }
  return { values, origins, card };
}

/**
 * `view: history` params — a frozen filter over the commit timeline,
 * mirroring the History page's URL filter state. A card with these params
 * IS a saved filter: a stable, linkable slice of history.
 */
export const HISTORY_VIEW_PARAMS = z
  .object({
    connectors: z.array(z.string()).optional(),
    workflows: z.array(z.string()).optional(),
    touchpoint: z.boolean().optional(),
    feedback: z.boolean().optional(),
    session: z.string().optional(),
  })
  .strict();
export type HistoryViewParams = z.infer<typeof HISTORY_VIEW_PARAMS>;

function parseQueryBool(raw: string): boolean | undefined {
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

/**
 * History's query spelling matches the History page's own search params
 * (`connector`/`workflow` singular, comma-separated) so the card-override
 * URL and the page URL speak one vocabulary.
 */
export const HISTORY_QUERY_CODEC: ViewQueryCodec = {
  fromQuery(query) {
    const out: Record<string, unknown> = {};
    const connector = query["connector"];
    if (connector !== undefined && connector !== "") {
      out["connectors"] = connector.split(",").filter((s) => s !== "");
    }
    const workflow = query["workflow"];
    if (workflow !== undefined && workflow !== "") {
      out["workflows"] = workflow.split(",").filter((s) => s !== "");
    }
    for (const key of ["touchpoint", "feedback"] as const) {
      const raw = query[key];
      if (raw !== undefined) {
        const parsed = parseQueryBool(raw);
        if (parsed !== undefined) out[key] = parsed;
      }
    }
    const session = query["session"];
    if (session !== undefined && session !== "") out["session"] = session;
    return out;
  },
  toQuery(values) {
    const parsed = HISTORY_VIEW_PARAMS.safeParse(values);
    if (!parsed.success) return {};
    const p = parsed.data;
    const out: Record<string, string> = {};
    if (p.connectors !== undefined && p.connectors.length > 0) out["connector"] = p.connectors.join(",");
    if (p.workflows !== undefined && p.workflows.length > 0) out["workflow"] = p.workflows.join(",");
    if (p.touchpoint !== undefined) out["touchpoint"] = String(p.touchpoint);
    if (p.feedback !== undefined) out["feedback"] = String(p.feedback);
    if (p.session !== undefined && p.session !== "") out["session"] = p.session;
    return out;
  },
};

export const NAMED_VIEWS: readonly NamedView[] = [
  {
    name: "landmarks",
    description: "Every landmark in the box, each with its resolved links",
  },
  {
    name: "chat-picker",
    description: "Fresh chats grouped by landmark, with a New-chat button per landmark",
  },
  {
    name: "history",
    description:
      "The commit timeline, filtered by the card's params (connectors, workflows, touchpoint, feedback, session) — a saved filter over history",
    params: HISTORY_VIEW_PARAMS,
    query: HISTORY_QUERY_CODEC,
  },
];

export const NAMED_VIEW_NAMES: readonly string[] = NAMED_VIEWS.map((v) => v.name);

const byName = new Map(NAMED_VIEWS.map((v) => [v.name, v]));

/** Look up a named view, or undefined for unknown names. */
export function namedViewFor(name: string): NamedView | undefined {
  return byName.get(name);
}
