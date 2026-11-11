/**
 * Collapsible device picker for the capture page — lets the user choose
 * which camera and microphone to use. Rendered below StatusBar when the
 * settings toggle is on.
 */

import { SelectField, type SelectOption } from "../../ui/fields/field";

interface DevicePrefs {
  videoDeviceId: string | null;
  audioDeviceId: string | null;
}

interface DeviceSettingsProps {
  includeControlIds?: boolean;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  devicePrefs: DevicePrefs;
  onUpdate: (key: keyof DevicePrefs, value: string | null) => void;
}

function deviceOptions(devices: MediaDeviceInfo[], fallbackName: string): SelectOption[] {
  return [
    { value: "", label: "Default" },
    ...devices.map((d) => ({ value: d.deviceId, label: d.label || `${fallbackName} ${d.deviceId.slice(0, 8)}` })),
  ];
}

export function DeviceSettings(props: DeviceSettingsProps) {
  const ids = props.includeControlIds !== false;
  return (
    <div className="px-4 py-3 bg-gray-900/90 border-t border-gray-700 z-10 flex gap-4 text-sm">
      <SelectField
        tone="dark"
        className="flex-1"
        id={ids ? "bbx-capture-camera-select" : undefined}
        label="Camera"
        value={props.devicePrefs.videoDeviceId ?? ""}
        onChange={(value) => props.onUpdate("videoDeviceId", value === "" ? null : value)}
        options={deviceOptions(props.videoDevices, "Camera")}
      />
      <SelectField
        tone="dark"
        className="flex-1"
        id={ids ? "bbx-capture-mic-select" : undefined}
        label="Microphone"
        value={props.devicePrefs.audioDeviceId ?? ""}
        onChange={(value) => props.onUpdate("audioDeviceId", value === "" ? null : value)}
        options={deviceOptions(props.audioDevices, "Mic")}
      />
    </div>
  );
}
