/**
 * HistoryFilterBar - Filter control strip for the History view.
 *
 * Exposes the browseable trailer axes — connector, what triggered the
 * commit, user touchpoint, and feedback signal — plus an active-session
 * chip that can be dismissed to drop the session filter.
 */

import { useMemo, type ReactNode } from "react";
import {
  TRIGGER_KINDS,
  TRIGGER_KIND_LABELS,
  type CommitTrigger,
} from "@shared/commit-trailers";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Toggle } from "../ui/Toggle";
import { CheckboxField } from "../ui/fields/field";
import { Popover, type PopoverTriggerProps } from "../ui/Popover";
import { InlineAction } from "../ui/InlineAction";
import { CloseButton } from "../ui/CloseButton";
import { MaterialContext } from "../ui/material";

export interface HistoryFilterState {
  connectors: string[];
  /** `<kind>/<name>` trigger ids — see @shared/commit-trailers. */
  triggers: string[];
  touchpoint: boolean;
  feedback: boolean;
  session: string | null;
  path: string | null;
}

export interface HistoryFilterFacets {
  connectors: string[];
  triggers: CommitTrigger[];
}

interface HistoryFilterBarProps {
  filter: HistoryFilterState;
  facets: HistoryFilterFacets | undefined;
  onChange: (next: HistoryFilterState) => void;
  idPrefix: string;
}

export function HistoryFilterBar({ filter, facets, onChange, idPrefix }: HistoryFilterBarProps) {
  const triggerOptions = useMemo(
    () =>
      (facets?.triggers ?? []).map((trigger) => ({
        value: trigger.id,
        label: trigger.name,
        group: TRIGGER_KIND_LABELS[trigger.kind].group,
      })),
    [facets]
  );

  const activeCount =
    filter.connectors.length +
    filter.triggers.length +
    (filter.touchpoint ? 1 : 0) +
    (filter.feedback ? 1 : 0) +
    (filter.session ? 1 : 0) +
    (filter.path ? 1 : 0);

  const clearAll = () => {
    onChange({
      connectors: [],
      triggers: [],
      touchpoint: false,
      feedback: false,
      session: null,
      path: null,
    });
  };

  const toggleValue = (axis: "connectors" | "triggers", value: string) => {
    const current = filter[axis];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filter, [axis]: next });
  };

  return (
    // The bar paints an app tint, so its controls keep app ink.
    <MaterialContext.Provider value={false}>
    <section aria-label="History filters" className="px-3 py-2 border-b border-warm-200 bg-warm-50/60">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectPopover
          id={`${idPrefix}-connector`}
          label="Connector"
          options={(facets?.connectors ?? []).map((value) => ({ value, label: value }))}
          selected={filter.connectors}
          onToggle={(v) => toggleValue("connectors", v)}
        />
        <MultiSelectPopover
          id={`${idPrefix}-trigger`}
          label="Triggered by"
          options={triggerOptions}
          groupOrder={TRIGGER_KINDS.map((kind) => TRIGGER_KIND_LABELS[kind].group)}
          selected={filter.triggers}
          onToggle={(v) => toggleValue("triggers", v)}
        />
        <ToggleChip
          id={`${idPrefix}-touchpoint`}
          label="Touchpoint"
          checked={filter.touchpoint}
          onChange={(v) => onChange({ ...filter, touchpoint: v })}
        />
        <ToggleChip
          id={`${idPrefix}-feedback`}
          label="Feedback"
          checked={filter.feedback}
          onChange={(v) => onChange({ ...filter, feedback: v })}
        />
        {activeCount > 0 ? (
          <span className="text-[0.6875rem] ml-auto">
            <InlineAction id={`${idPrefix}-clear`} intent="subtle" onClick={clearAll}>
              Clear
            </InlineAction>
          </span>
        ) : null}
      </div>
      {filter.session ? (
        <div className="mt-2">
          <Badge tone="accent" size="sm">
            <span className="font-mono">Chat {filter.session.slice(0, 8)}</span>
            <CloseButton id={`${idPrefix}-clear-session`} size="sm" ink label="Clear chat filter" onClick={() => onChange({ ...filter, session: null })} className="-my-1.5 -mr-2" />
          </Badge>
        </div>
      ) : null}
      {filter.path ? (
        <div className="mt-2">
          <Badge tone="accent" size="sm">
            <span className="font-mono">Path {filter.path}</span>
            <CloseButton id={`${idPrefix}-clear-path`} size="sm" ink label="Clear path filter" onClick={() => onChange({ ...filter, path: null })} className="-my-1.5 -mr-2" />
          </Badge>
        </div>
      ) : null}
    </section>
    </MaterialContext.Provider>
  );
}

/** One selectable value on a filter axis; `group` heads a labelled section. */
interface FilterOption {
  value: string;
  label: string;
  group?: string;
}

interface MultiSelectPopoverProps {
  /** Stable `bbx-` control address for the popover's trigger (see lib/ui-scan). */
  id: string;
  label: string;
  options: FilterOption[];
  /** Group headings in display order; groups with no options are skipped. */
  groupOrder?: string[];
  selected: string[];
  onToggle: (value: string) => void;
}

function MultiSelectPopover({ id, label, options, groupOrder, selected, onToggle }: MultiSelectPopoverProps) {
  const hasSelection = selected.length > 0;
  const firstLabel = options.find((o) => o.value === selected[0])?.label ?? selected[0];
  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label}: ${firstLabel}`
        : `${label}: ${firstLabel} +${selected.length - 1}`;

  // Only heading a group when more than one is present: a single-kind list
  // reads as a plain list of run names rather than one redundant header.
  const groups = groupOrder?.filter((g) => options.some((o) => o.group === g)) ?? [];
  const sections: { heading: string | null; options: FilterOption[] }[] =
    groups.length > 1
      ? groups.map((heading) => ({ heading, options: options.filter((o) => o.group === heading) }))
      : [{ heading: null, options }];

  return (
    <Popover
      label={label}
      trigger={({ toggle, ariaProps }) => (
        <FilterChipButton id={id} active={hasSelection} onClick={toggle} ariaProps={ariaProps}>
          {summary}
          <span className="ml-1 text-warm-400" aria-hidden="true">▾</span>
        </FilterChipButton>
      )}
    >
      {options.length === 0 ? (
        <div className="text-xs text-warm-700 italic">No values</div>
      ) : (
        sections.map((section) => (
          <div key={section.heading ?? ""}>
            {section.heading === null ? null : (
              <div className="pt-1.5 pb-0.5 text-[0.625rem] uppercase tracking-wide text-warm-700">
                {section.heading}
              </div>
            )}
            {section.options.map((opt) => (
              <CheckboxField
                key={opt.value}
                checked={selected.includes(opt.value)}
                onChange={() => onToggle(opt.value)}
                label={<span className="block truncate">{opt.label}</span>}
                className="py-1"
              />
            ))}
          </div>
        ))
      )}
    </Popover>
  );
}

interface ToggleChipProps {
  /** Stable `bbx-` control address for the switch (see lib/ui-scan). */
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleChip({ id, label, checked, onChange }: ToggleChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Toggle id={id} checked={checked} onChange={onChange} label={label} />
      <span className={cn("text-xs", checked ? "text-warm-800 font-medium" : "text-warm-700")}>
        {label}
      </span>
    </span>
  );
}

interface FilterChipButtonProps {
  id: string;
  active: boolean;
  onClick: PopoverTriggerProps["toggle"];
  children: ReactNode;
  /** The Popover trigger's ARIA, when the chip opens one. */
  ariaProps?: PopoverTriggerProps["ariaProps"];
}

function FilterChipButton({ id, active, onClick, children, ariaProps }: FilterChipButtonProps) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      {...ariaProps}
      className={cn(
        "inline-flex items-center text-xs px-2 py-1 rounded-full border transition-colors",
        active
          ? "bg-primary-50 border-primary text-primary-dark"
          : "bg-white border-warm-200 text-warm-700 hover:bg-warm-50"
      )}
    >
      {children}
    </button>
  );
}
