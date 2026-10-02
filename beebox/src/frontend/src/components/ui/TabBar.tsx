import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface TabDef<V extends string> {
  value: V;
  label: ReactNode;
  /** Optional count badge after the label. */
  count?: number;
  disabled?: boolean;
}

export interface TabBarProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  tabs: TabDef<V>[];
  /** aria-label for the tablist — used when there's no visible heading. */
  label?: string;
  /**
   * Stable `bbx-` address prefix (see lib/ui-scan): each tab button gets
   * `${idPrefix}-${tab.value}`, so a fixed tab set is addressable by name.
   */
  idPrefix?: string;
  /** Each tab gets `aria-controls="${controlsPrefix}-${tab.value}"`, the id of its panel. */
  controlsPrefix?: string;
  /**
   * Visual style. `"underline"` (default) is a row of tabs on a rule, for a
   * pane that switches between views of one thing. `"pills"` is a row of
   * rounded chips that wraps on narrow screens, for a page whose tabs are
   * distinct groups of content.
   */
  variant?: "underline" | "pills";
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const UNDERLINE_STATE: Record<"disabled" | "active" | "idle", string> = {
  disabled: "border-transparent text-warm-400 cursor-not-allowed",
  active: "border-primary text-primary font-medium",
  idle: "border-transparent text-warm-600 hover:text-warm-800 hover:border-warm-300 cursor-pointer",
};

const PILL_STATE: Record<"disabled" | "active" | "idle", string> = {
  disabled: "bg-transparent text-warm-400 cursor-not-allowed",
  active: "bg-primary text-white font-medium",
  idle: "bg-warm-100 text-warm-700 hover:bg-warm-200 cursor-pointer",
};

export function TabBar<V extends string>({ value, onChange, tabs, label, idPrefix, controlsPrefix, variant, className }: TabBarProps<V>) {
  const pills = variant === "pills";
  // Roving focus: one tab stop, arrows move between enabled tabs and select as they go.
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const enabled = tabs.filter(tab => tab.disabled !== true);
    const current = enabled.findIndex(tab => tab.value === value);
    if (enabled.length === 0 || current === -1) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : step === 0 ? -1 : (current + step + enabled.length) % enabled.length;
    if (target === -1) return;
    event.preventDefault();
    const next = enabled[target];
    if (next === undefined || next.value === value) return;
    onChange(next.value);
    if (idPrefix !== undefined) document.getElementById(`${idPrefix}-${next.value}`)?.focus();
    else event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[tabs.indexOf(next)]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn(pills ? "flex flex-wrap gap-2" : "flex gap-0 border-b border-warm-300", className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        const disabled = tab.disabled === true;
        const state = disabled ? "disabled" : active ? "active" : "idle";
        const stateClass = pills ? PILL_STATE[state] : UNDERLINE_STATE[state];
        return (
          <button
            key={tab.value}
            id={idPrefix !== undefined ? `${idPrefix}-${tab.value}` : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={controlsPrefix !== undefined ? `${controlsPrefix}-${tab.value}` : undefined}
            aria-disabled={disabled || undefined}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onKeyDown={onKeyDown}
            onClick={() => {
              if (!disabled) onChange(tab.value);
            }}
            className={cn(pills ? "px-3 py-1 text-sm rounded-full" : "px-4 py-1.5 text-sm border-b-2", "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent", stateClass)}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn("ml-1 text-xs", active ? (pills ? "text-white/80" : "text-primary") : "text-warm-500")}>
                ({tab.count})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
