/**
 * Collapsible device picker for the capture page — lets the user choose
 * which camera and microphone to use. Rendered below StatusBar when the
 * settings toggle is on.
 */

interface DevicePrefs {
  videoDeviceId: string | null;
  audioDeviceId: string | null;
}

interface DeviceSettingsProps {
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  devicePrefs: DevicePrefs;
  onUpdate: (key: keyof DevicePrefs, value: string | null) => void;
}

export function DeviceSettings(props: DeviceSettingsProps) {
  return (
    <div className="px-4 py-3 bg-gray-900/90 border-t border-gray-700 z-10 flex gap-4 text-sm">
      <label className="flex flex-col gap-1 flex-1">
        <span className="text-gray-400">Camera</span>
        <select
          id="bbx-capture-camera-select"
          value={props.devicePrefs.videoDeviceId ?? ""}
          onChange={(e) => props.onUpdate("videoDeviceId", e.target.value || null)}
          className="bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-sm"
        >
          <option value="">Default</option>
          {props.videoDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 flex-1">
        <span className="text-gray-400">Microphone</span>
        <select
          id="bbx-capture-mic-select"
          value={props.devicePrefs.audioDeviceId ?? ""}
          onChange={(e) => props.onUpdate("audioDeviceId", e.target.value || null)}
          className="bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-sm"
        >
          <option value="">Default</option>
          {props.audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
