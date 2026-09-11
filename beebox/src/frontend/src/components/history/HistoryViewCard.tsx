import { useId } from "react";
import { HISTORY_VIEW_PARAMS, type ResolvedViewParams } from "@shared/named-views";
import type { RendererProps } from "../../file-type-registry";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { HistoryBrowser } from "./HistoryBrowser";
import { describeFilter, paramsToFilter } from "./history-filter";
import { parseHistoryCardState } from "./history-card-state";

export function HistoryViewCard(props: Omit<RendererProps, "params"> & { params?: ResolvedViewParams; legacyParams?: Record<string, string> }) {
  const instanceId = useId().replaceAll(":", "");
  const parsedCard = HISTORY_VIEW_PARAMS.safeParse(props.params?.card ?? {});
  const parsedValues = HISTORY_VIEW_PARAMS.safeParse(props.params?.values ?? {});
  const parsedState = parseHistoryCardState(props.viewState ?? null);
  const error = !parsedCard.success ? parsedCard.error : !parsedValues.success ? parsedValues.error : !parsedState.success ? parsedState.error : null;
  if (error !== null) {
    return <Card padding="md" border="subtle" muted>
      <Text as="div" size="sm" weight="medium" tone="emphasis">Invalid history state</Text>
      <Text as="div" size="sm" tone="muted">{error.issues.map(issue => `${issue.path.join(".") || "state"}: ${issue.message}`).join("; ")}</Text>
    </Card>;
  }
  const cardDefaults = paramsToFilter(parsedCard.data ?? {});
  const queryDefaults = { ...paramsToFilter(parsedValues.data ?? {}), ...(props.legacyParams?.path === undefined ? {} : { path: props.legacyParams.path }) };
  const state = parsedState.data ?? {};
  const filter = state.filter ?? queryDefaults;
  const overridden = JSON.stringify(filter) !== JSON.stringify(cardDefaults);
  const update = (next: typeof state, method: "push" | "replace") => props.onViewStateChange?.(next, method);
  return <div className="flex flex-col gap-2">
    <Row justify="between" align="start" wrap className="px-3">
      <Text as="span" size="sm" tone="muted" className="min-w-0 flex-1 break-words">{describeFilter(filter)}</Text>
      {overridden ? <Text as="span" size="xs" tone="muted" className="shrink-0 whitespace-normal">Modified from card · <button id={`bbx-history-view-reset-${instanceId}`} type="button" onClick={() => update({ filter: cardDefaults }, "push")} className="text-info-dark hover:underline">reset</button></Text> : null}
    </Row>
    <div className="h-[70vh] min-h-96 border border-subtle rounded overflow-hidden">
      <HistoryBrowser filter={filter} filterBar onFilterChange={next => update({ filter: next }, "push")} selectedHash={state.commit} onSelectedHashChange={commit => update({ ...state, commit }, "replace")} idPrefix={`bbx-history-${instanceId}`} />
    </div>
  </div>;
}
