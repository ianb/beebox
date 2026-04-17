import type { ReactNode } from "react";

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
}

export function TabBar<V extends string>({ value, onChange, tabs, label }: TabBarProps<V>) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-0 border-b border-warm-300">
      {tabs.map((tab) => {
        const active = tab.value === value;
        const disabled = tab.disabled === true;
        const stateClass = disabled
          ? "border-transparent text-warm-400 cursor-not-allowed"
          : active
            ? "border-plum text-plum font-medium"
            : "border-transparent text-warm-600 hover:text-warm-800 hover:border-warm-300 cursor-pointer";
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(tab.value);
            }}
            className={`px-4 py-1.5 text-sm border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${stateClass}`}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className={`ml-1 text-xs ${active ? "text-plum" : "text-warm-500"}`}>
                ({tab.count})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
