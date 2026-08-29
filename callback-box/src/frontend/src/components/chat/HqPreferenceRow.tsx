import { type ReactNode } from "react";

export type HqValue = "on" | "off";
export type LandmarkHqValue = HqValue | "inherit";

export interface HqDefaultsState {
  canManage: boolean;
  hasLandmark: boolean;
  landmark: LandmarkHqValue;
  box: HqValue;
  pending: boolean;
  onLandmarkChange: (value: LandmarkHqValue) => void;
  onBoxChange: (value: HqValue) => void;
}

function ScopeChoice(props: {
  id: string;
  active: boolean;
  disabled?: boolean;
  label: string;
  accessibleLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      id={props.id}
      type="button"
      aria-pressed={props.active}
      aria-label={props.accessibleLabel ?? props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`rounded px-1.5 py-0.5 text-xs ${props.active ? "bg-warm-700 text-white" : "text-warm-500 hover:bg-warm-100"} disabled:opacity-40`}
    >
      {props.label}
    </button>
  );
}

export function HqPreferenceRow(props: {
  enabled: boolean;
  onToggle: () => void;
  defaults: HqDefaultsState;
  icon: ReactNode;
}) {
  const { defaults } = props;
  return (
    <div className="px-3 py-2 text-warm-700" role="group" aria-label="HQ dictation preferences">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={props.enabled ? undefined : "opacity-40"} aria-hidden="true">{props.icon}</span>
        <span className="mr-auto">HQ dictation</span>
        <span className="text-xs text-warm-500">Chat</span>
        <ScopeChoice id="cb-voice-hq-dictation" active={props.enabled} label={props.enabled ? "on" : "off"} accessibleLabel={`Chat HQ dictation ${props.enabled ? "on" : "off"}`} onClick={props.onToggle} />
        {defaults.canManage ? (
          <>
          <span className="text-xs text-warm-500">Landmark</span>
          {(["inherit", "on", "off"] as const).map((value) => (
            <ScopeChoice key={value} id={`cb-voice-hq-landmark-${value}`} active={defaults.landmark === value} disabled={defaults.pending || !defaults.hasLandmark} label={value} accessibleLabel={`Landmark HQ dictation ${value}`} onClick={() => defaults.onLandmarkChange(value)} />
          ))}
          <span className="ml-1 text-xs text-warm-500">Box</span>
          <ScopeChoice id="cb-voice-hq-box" active={defaults.box === "on"} disabled={defaults.pending} label={defaults.box} accessibleLabel={`Box HQ dictation ${defaults.box}`} onClick={() => defaults.onBoxChange(defaults.box === "on" ? "off" : "on")} />
          </>
        ) : null}
      </div>
    </div>
  );
}
