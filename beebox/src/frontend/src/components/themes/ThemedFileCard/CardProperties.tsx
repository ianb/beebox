import { useEffect, useRef } from "react";
import { trpc } from "../../../lib/trpc/client";
import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { Button } from "../../ui/Button";
import type { FileData } from "../../../file-type-registry";
import type { NavigateHint, ViewTarget } from "../../../lib/view-url";
import { withBase } from "../../../api";
import { useParams } from "@tanstack/react-router";
import { serializeViewUrl } from "../../../lib/view-url";
import { splitCardFields } from "../../../lib/card-field-faces";
import { FrontmatterFields } from "../../MarkdownCardView/FrontmatterFields";
import { CardMark } from "../../ui/CardMark";
import { isRecord } from "@shared/is-record";
import { readCardSymbol } from "@shared/card-symbol";
import { Prominence, effectiveLevel } from "@shared/prominence";

/** "<level>" when the card declares one, "<level>, the type's default" when it does not; the raw value when the schema is unknown. */
function prominenceText(value: unknown, schema: FileData["schema"]): string | null {
  if (schema === undefined || schema === null) return typeof value === "string" ? value : null;
  const declared = Prominence.safeParse(value);
  const level = effectiveLevel({ declared: declared.success ? declared.data : undefined, typeDefault: schema.defaultProminence });
  return declared.success ? level : `${level}, the type's default`;
}

/** The `symbol:` group as written, e.g. "glyph: 🏠 · background: #fde". */
function symbolSourceText(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return JSON.stringify(value);
  return Object.entries(value).map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`).join(" · ");
}

/**
 * The card as an object: where it is filed, its type, how it is found (the
 * common fields Properties names), then its type fields; `splitCardFields`
 * decides which is which.
 */
export function CardFacts({ data, boxSlug, onNavigate }: {
  data: FileData;
  boxSlug: string | undefined;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}) {
  const { foundBy, properties } = splitCardFields(data.frontmatter ?? {}, { hasBodyField: data.schema?.hasBodyField ?? null, mode: "page" });
  const contains = foundBy.contains;
  const evidence = foundBy["contains-evidence"];
  const prominence = prominenceText(foundBy.prominence, data.schema);
  const symbolSource = symbolSourceText(foundBy.symbol);
  const symbol = readCardSymbol(foundBy.symbol, { cardPath: data.path.replace(/^\//, "") });
  const hasFoundBy = typeof contains === "string" || prominence !== null || symbolSource !== null || typeof evidence === "string";
  return <>
    <dl className="mt-4">
      <dt>Filed at</dt><dd>{data.path}</dd>
      <dt>Card type</dt><dd>{data.type}</dd>
    </dl>
    {hasFoundBy ? <div className="mt-6" data-card-section="found-by">
      <h3 className="text-sm font-semibold mb-2">Found by</h3>
      <dl>
        {typeof contains === "string" ? <><dt>Contains</dt><dd>{contains}</dd></> : null}
        {prominence === null ? null : <><dt>Prominence</dt><dd>{prominence}</dd></>}
        {symbolSource === null ? null : <><dt>Symbol</dt><dd className="flex items-center gap-2">
          <CardMark symbol={symbol} size="sm" boxSlug={boxSlug} /><span>{symbolSource}</span>
        </dd></>}
      </dl>
      {typeof evidence === "string" ? <details className="mt-2">
        <summary className="text-sm cursor-pointer">Contains evidence</summary>
        <p className="text-sm whitespace-pre-wrap">{evidence}</p>
      </details> : null}
    </div> : null}
    {Object.keys(properties).length > 0 ? <div className="mt-6" data-card-section="fields">
      <h3 className="text-sm font-semibold mb-2">Fields</h3>
      <FrontmatterFields fields={properties} onNavigate={onNavigate} basePath={data.path} />
    </div> : null}
  </>;
}

/** Mounted only while Properties is open: no box scan for every visible card. */
export function CardMentions({ path, onNavigate }: { path: string; onNavigate: (target: ViewTarget, hint?: NavigateHint) => void }) {
  const { boxSlug } = useParams({ strict: false });
  const query = trpc.card.inboundRefs.useQuery({ path }, { staleTime: 10_000 });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current !== null) clearTimeout(pending.current); }, []);
  useBusSubscription({
    onEvent: ({ event }) => {
      if (event !== "file-change" || pending.current !== null) return;
      pending.current = setTimeout(() => { pending.current = null; void query.refetch(); }, 500);
    },
    onConnect: () => { void query.refetch(); },
  });
  const incomplete = (query.data?.errors ?? []).length > 0;
  return <section className="mt-6" aria-label="Mentions">
    <h3 className="text-sm font-semibold mb-2">Mentioned by</h3>
    {query.isLoading ? <p className="text-sm" role="status">Checking mentions…</p> : null}
    {query.error || incomplete ? <div role="status" className="text-sm">
      <p>{query.error ? `Could not check mentions: ${query.error.message}` : "Some files could not be checked. This list is incomplete."}</p>
      <Button size="sm" intent="ghost" onClick={() => { void query.refetch(); }}>Retry</Button>
    </div> : null}
    {query.data?.referrers.length === 0 && !incomplete && !query.error ? <p className="text-sm">No mentions yet.</p> : null}
    <ul className="space-y-2 text-sm">
      {query.data?.referrers.map((referrer) => {
        const target: ViewTarget = { path: referrer.path, viewer: null, params: {}, viewState: null };
        return <li key={referrer.path}><a className="bbx-theme-link" href={withBase(`/${boxSlug}/views/${serializeViewUrl(target)}`)}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault(); onNavigate(target);
          }}>{referrer.path}</a></li>;
      })}
    </ul>
  </section>;
}
