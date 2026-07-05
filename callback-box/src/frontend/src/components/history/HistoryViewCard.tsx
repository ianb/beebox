/**
 * `view: history` card surface — a saved filter over the commit timeline.
 *
 * The card's frontmatter params are the durable filter; URL query params
 * overlay them per key (the cascade is merged upstream, in the view-card
 * renderer, with per-key provenance). Filter interactions inside the card
 * (session/connector/workflow chips) stay on the card's address as
 * override-URLs — explore in the URL, commit to the card — and a marker
 * names any URL-overridden keys with a reset back to the card's own
 * config. "Open in History" escapes to the interactive page carrying the
 * merged filter. Invalid params render an explicit error, never a blank
 * or unfiltered surface.
 */

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  HISTORY_QUERY_CODEC,
  HISTORY_VIEW_PARAMS,
  type ResolvedViewParams,
} from "@shared/named-views";
import { href } from "../../lib/routing";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { HistoryBrowser } from "./HistoryBrowser";
import { describeFilter, filterToSearch, paramsToFilter } from "./history-filter";
import type { HistoryFilterState } from "../HistoryFilterBar";

export function HistoryViewCard({ params }: { params?: ResolvedViewParams }) {
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();

  const parsed = HISTORY_VIEW_PARAMS.safeParse(params?.values ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    return (
      <Card padding="md" border="subtle" muted>
        <Text as="div" size="sm" weight="medium" tone="emphasis">
          Invalid history params
        </Text>
        <Text as="div" size="sm" tone="muted">{detail}</Text>
      </Card>
    );
  }

  const filter = paramsToFilter(parsed.data);
  const overriddenKeys = Object.entries(params?.origins ?? {})
    .filter(([, origin]) => origin === "url")
    .map(([key]) => key);
  const historyPath = href(`/${boxSlug}/history`);

  // Chips adjust the filter without leaving the card: keys that actually
  // differ from the card's own config are spelled as query-string
  // overrides on the card's address — keys merely restating the card stay
  // out of the URL, so provenance never over-reports.
  const applyOverride = (next: HistoryFilterState) => {
    const overrides = diffAgainstCard(filterToParamsShape(next), params?.card ?? {});
    navigate({
      search: HISTORY_QUERY_CODEC.toQuery(overrides) as never,
      replace: false,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Row justify="between" align="center">
        <Text as="span" size="sm" tone="muted">{describeFilter(filter)}</Text>
        <Row gap="sm" align="center">
          {overriddenKeys.length > 0 ? (
            <Text as="span" size="xs" tone="muted">
              URL overrides: {overriddenKeys.join(", ")} ·{" "}
              <button
                type="button"
                onClick={() => navigate({ search: {} as never, replace: false })}
                className="text-info-dark hover:underline"
              >
                reset
              </button>
            </Text>
          ) : null}
          <Link
            to={historyPath}
            search={filterToSearch(filter) as never}
            className="text-sm text-info-dark hover:underline"
          >
            Open in History →
          </Link>
        </Row>
      </Row>
      <div className="h-[70vh] min-h-96 border border-subtle rounded overflow-hidden">
        <HistoryBrowser
          filter={filter}
          filterBar={false}
          onFilterChange={applyOverride}
        />
      </div>
    </div>
  );
}

/** Filter state → the params shape the codec speaks (drops empties). */
function filterToParamsShape(filter: HistoryFilterState): Record<string, unknown> {
  return {
    ...(filter.connectors.length > 0 ? { connectors: filter.connectors } : {}),
    ...(filter.workflows.length > 0 ? { workflows: filter.workflows } : {}),
    ...(filter.touchpoint ? { touchpoint: true } : {}),
    ...(filter.feedback ? { feedback: true } : {}),
    ...(filter.session !== null ? { session: filter.session } : {}),
  };
}

/**
 * Keys of `next` that differ from the card layer, plus explicit `false`
 * for card booleans the next state turns off (the codec can spell that;
 * dropped list/string keys have no unset spelling and aren't reachable
 * from the chips, which only add).
 */
function diffAgainstCard(
  next: Record<string, unknown>,
  card: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(card[key]) !== JSON.stringify(value)) out[key] = value;
  }
  for (const key of ["touchpoint", "feedback"]) {
    if (card[key] === true && next[key] === undefined) out[key] = false;
  }
  return out;
}
