/**
 * HistoryFilterBar - Filter control strip for the History view.
 *
 * Exposes the browseable trailer axes — connector, workflow, user
 * touchpoint, and feedback signal — plus an active-session chip that
 * can be dismissed to drop the session filter.
 */

import { useState, useRef, useEffect, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Badge } from "./ui/Badge";
import { Toggle } from "./ui/Toggle";

export interface HistoryFilterState {
  connectors: string[];
  workflows: string[];
  touchpoint: boolean;
  feedback: boolean;
  session: string | null;
}

export interface HistoryFilterFacets {
  connectors: string[];
  workflows: string[];
}

interface HistoryFilterBarProps {
  filter: HistoryFilterState;
  facets: HistoryFilterFacets | undefined;
  onChange: (next: HistoryFilterState) => void;
}

export function HistoryFilterBar({ filter, facets, onChange }: HistoryFilterBarProps) {
  const activeCount =
    filter.connectors.length +
    filter.workflows.length +
    (filter.touchpoint ? 1 : 0) +
    (filter.feedback ? 1 : 0) +
    (filter.session ? 1 : 0);

  const clearAll = () => {
    onChange({
      connectors: [],
      workflows: [],
      touchpoint: false,
      feedback: false,
      session: null,
    });
  };

  const toggleValue = (axis: "connectors" | "workflows", value: string) => {
    const current = filter[axis];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filter, [axis]: next });
  };

  return (
    <section aria-label="History filters" className="px-3 py-2 border-b border-warm-200 bg-warm-50/60">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectPopover
          label="Connector"
          options={facets?.connectors ?? []}
          selected={filter.connectors}
          onToggle={(v) => toggleValue("connectors", v)}
        />
        <MultiSelectPopover
          label="Workflow"
          options={facets?.workflows ?? []}
          selected={filter.workflows}
          onToggle={(v) => toggleValue("workflows", v)}
        />
        <ToggleChip
          label="Touchpoint"
          checked={filter.touchpoint}
          onChange={(v) => onChange({ ...filter, touchpoint: v })}
        />
        <ToggleChip
          label="Feedback"
          checked={filter.feedback}
          onChange={(v) => onChange({ ...filter, feedback: v })}
        />
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-warm-500 hover:text-warm-700 underline ml-auto"
          >
            Clear
          </button>
        ) : null}
      </div>
      {filter.session ? (
        <div className="mt-2">
          <Badge tone="accent" size="sm">
            <span className="font-mono">Session {filter.session.slice(0, 8)}</span>
            <button
              type="button"
              onClick={() => onChange({ ...filter, session: null })}
              className="ml-1 text-primary-dark hover:text-danger"
              aria-label="Clear session filter"
            >
              ×
            </button>
          </Badge>
        </div>
      ) : null}
    </section>
  );
}

interface MultiSelectPopoverProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}

function MultiSelectPopover({ label, options, selected, onToggle }: MultiSelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const hasSelection = selected.length > 0;
  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label}: ${selected[0]}`
        : `${label}: ${selected[0]} +${selected.length - 1}`;

  return (
    <div className="relative" ref={rootRef}>
      <FilterChipButton
        active={hasSelection}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {summary}
        <span className="ml-1 text-warm-400" aria-hidden="true">▾</span>
      </FilterChipButton>
      {open ? (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-warm-200 py-1 z-50 w-60 max-h-72 overflow-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-warm-500 italic">No values</div>
          ) : (
            options.map((opt) => {
              const isSelected = selected.includes(opt);
              return (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-warm-700 hover:bg-warm-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(opt)}
                    className="accent-primary"
                  />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

interface ToggleChipProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleChip({ label, checked, onChange }: ToggleChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Toggle checked={checked} onChange={onChange} label={label} />
      <span className={cn("text-xs", checked ? "text-warm-800 font-medium" : "text-warm-600")}>
        {label}
      </span>
    </span>
  );
}

interface FilterChipButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  "aria-haspopup"?: "listbox";
  "aria-expanded"?: boolean;
}

function FilterChipButton({ active, onClick, children, ...aria }: FilterChipButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...aria}
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
