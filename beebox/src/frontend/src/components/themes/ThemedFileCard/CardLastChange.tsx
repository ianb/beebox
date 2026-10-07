import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { trpc } from "../../../lib/trpc/client";
import { lastChangeLine } from "../../../lib/last-change-line";
import { useNow } from "../../../lib/use-now";
import type { NavigateHint, ViewTarget } from "../../../lib/view-url";
import { legacyHistoryState } from "../../history/card-state";
import { PropertyLink, PropertyProblem, useRefetchOnFileChange } from "./property-section";

/**
 * The newest commit touching the card (history follows renames), and a link
 * to the History card filtered to it, as the card actions menu opens it.
 * Mounted only while Properties is open.
 */
export function CardLastChange({ path, onNavigate }: { path: string; onNavigate: (target: ViewTarget, hint?: NavigateHint) => void }) {
  const query = trpc.history.list.useQuery({ filter: { path }, count: 1 }, { staleTime: 10_000 });
  useRefetchOnFileChange(query.refetch);
  const now = useNow(60_000);
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
