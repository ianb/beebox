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

function ScopeControl(props: {
  id: string;
  disabled?: boolean;
  label: string;
  accessibleLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      id={props.id}
      type="button"
      aria-label={props.accessibleLabel}
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded px-1.5 py-0.5 text-xs text-warm-500 hover:bg-warm-100 disabled:opacity-40"
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
  const nextLandmark: LandmarkHqValue = defaults.landmark === "inherit"
    ? "on"
    : defaults.landmark === "on" ? "off" : "inherit";
  return (
    <div className="px-3 py-2 text-warm-700" role="group" aria-label="HQ dictation preferences">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
        <span className={props.enabled ? undefined : "opacity-40"} aria-hidden="true">{props.icon}</span>
        <span>HQ dictation</span>
        <ScopeControl id="bbx-voice-hq-dictation" label={`Chat: ${props.enabled ? "on" : "off"}`} accessibleLabel={`Change Chat HQ dictation, currently ${props.enabled ? "on" : "off"}`} onClick={props.onToggle} />
        {defaults.canManage ? (
          <div className="col-span-3 flex justify-end gap-1.5">
            <ScopeControl id="bbx-voice-hq-landmark" disabled={defaults.pending || !defaults.hasLandmark} label={`Landmark: ${defaults.landmark}`} accessibleLabel={`Change Landmark HQ dictation, currently ${defaults.landmark}`} onClick={() => defaults.onLandmarkChange(nextLandmark)} />
            <ScopeControl id="bbx-voice-hq-box" disabled={defaults.pending} label={`Box: ${defaults.box}`} accessibleLabel={`Change Box HQ dictation, currently ${defaults.box}`} onClick={() => defaults.onBoxChange(defaults.box === "on" ? "off" : "on")} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
