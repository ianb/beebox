/**
 * `view: history` card surface — a saved filter over the commit timeline.
 *
 * The card's frontmatter params ARE the filter; there's no filter bar.
 * Any filter interaction inside (session/connector/workflow chips) escapes
 * to the interactive History page carrying the adjusted filter, as does
 * the header's "Open in History" link. Invalid params (possible despite
 * cb validate — e.g. an edit that skipped hooks) render an explicit error
 * naming the problem, never a blank or unfiltered surface.
 */

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { HISTORY_VIEW_PARAMS } from "@shared/named-views";
import { href } from "../../lib/routing";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { HistoryBrowser } from "./HistoryBrowser";
import { describeFilter, filterToSearch, paramsToFilter } from "./history-filter";

export function HistoryViewCard({ params }: { params?: Record<string, unknown> }) {
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();

  const parsed = HISTORY_VIEW_PARAMS.safeParse(params ?? {});
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
  const historyPath = href(`/${boxSlug}/history`);

  return (
    <div className="flex flex-col gap-2">
      <Row justify="between" align="center">
        <Text as="span" size="sm" tone="muted">{describeFilter(filter)}</Text>
        <Link
          to={historyPath}
          search={filterToSearch(filter) as never}
          className="text-sm text-info-dark hover:underline"
        >
          Open in History →
        </Link>
      </Row>
      <div className="h-[70vh] min-h-96 border border-subtle rounded overflow-hidden">
        <HistoryBrowser
          filter={filter}
          filterBar={false}
          onFilterChange={(next) => {
            navigate({ to: historyPath, search: filterToSearch(next) as never });
          }}
        />
      </div>
    </div>
  );
}
