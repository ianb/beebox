import { useEffect, useRef } from "react";
import { trpc } from "../../lib/trpc";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { Button } from "../ui/Button";
import { FriendlyDate } from "../ui/FriendlyDate";
import type { FileData } from "../../renderers";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import { withBase } from "../../api";
import { useParams } from "@tanstack/react-router";
import { serializeViewUrl } from "../../lib/view-url";

export function CardFacts({ data }: { data: FileData }) {
  const fm = data.frontmatter;
  const created = typeof fm?.created === "string" ? fm.created : null;
  const source = typeof fm?.source === "string" ? fm.source : null;
  return <dl className="mt-4">
    <dt>Filed at</dt><dd>{data.path}</dd>
    <dt>Card type</dt><dd>{data.type}</dd>
    {created ? <><dt>Created</dt><dd><FriendlyDate iso={created} mode="date" /></dd></> : null}
    {source ? <><dt>Source</dt><dd>{source}</dd></> : null}
    {typeof fm?.prominence === "string" ? <><dt>Prominence</dt><dd>{fm.prominence}</dd></> : null}
  </dl>;
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
