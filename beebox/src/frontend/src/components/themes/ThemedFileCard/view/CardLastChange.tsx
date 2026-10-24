import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { trpc } from "../../../../lib/trpc/client";
import { lastChangeLine } from "../../../../lib/last-change-line";
import { useBoxNow } from "../../../../lib/box-clock";
import type { NavigateHint, ViewTarget } from "../../../../lib/view-url";
import { legacyHistoryState } from "../../../history/card-state";
import { PropertyLink, PropertyProblem } from "./property-section";
import { useLiveRefresh } from "../../../../hooks/useLiveRefresh";
import { anyFileChange } from "../../../../lib/live-refresh";

/**
 * The newest commit touching the card (history follows renames), and a link
 * to the History card filtered to it, as the card actions menu opens it.
 * Mounted only while Properties is open.
 */
export function CardLastChange({ path, onNavigate }: { path: string; onNavigate: (target: ViewTarget, hint?: NavigateHint) => void }) {
  // Mounted only while shown, so a change made while closed was never seen:
  // fetch on every open rather than trust the cache.
  const query = trpc.history.list.useQuery({ filter: { path }, count: 1 }, { staleTime: 10_000, refetchOnMount: "always" });
  useLiveRefresh({ when: anyFileChange, refresh: () => { void query.refetch(); }, burstMs: 500 });
  const now = useBoxNow(60_000);
  const commit = query.data?.commits.at(0);
  const line = commit === undefined ? null : lastChangeLine(commit, now === 0 ? null : now);
  const history: ViewTarget = { path: SYSTEM_CARD_PATHS.history, viewer: null, params: {}, viewState: legacyHistoryState({ path }) };
  return <section className="mt-6" aria-label="Last change" data-card-section="changed">
    <h3 className="text-sm font-semibold mb-2">Changed</h3>
    {query.isLoading ? <p className="text-sm" role="status">Checking history…</p> : null}
    {query.error ? <PropertyProblem message={`Could not read history: ${query.error.message}`} onRetry={() => { void query.refetch(); }} /> : null}
    {query.data && line === null ? <p className="text-sm">Not committed yet</p> : null}
    {line === null ? null : <p className="text-sm">
      <span title={line.title}>{line.text}</span>{" "}
      <PropertyLink target={history} hint={{ label: "History" }} onNavigate={onNavigate}>History</PropertyLink>
    </p>}
  </section>;
}
