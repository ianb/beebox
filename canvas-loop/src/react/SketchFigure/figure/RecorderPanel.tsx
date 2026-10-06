// The optional record panel (`showRecorder`): a live count of dispatched inputs
// and a collapsible view of the events-file JSON the runtime has captured so
// far. Presentational — the JSON string and count are handed in; copying reaches
// for the clipboard only on click, so nothing here runs during render or SSR.
import type { JSX } from "react";

export interface RecorderPanelProps {
  json: string;
  count: number;
}

function copy(text: string): void {
  try {
    // `navigator.clipboard` is typed non-optional but is genuinely absent in an
    // insecure context — a bare access throws synchronously, caught here.
    void navigator.clipboard.writeText(text).catch(() => {
      // Write rejected (permissions denied); the textarea still shows the JSON.
    });
  } catch (_e) {
    // Clipboard API unavailable (insecure context); the textarea still shows it.
  }
}

/** Live recorded-events viewer for a figure (shown when `showRecorder` is set). */
export function RecorderPanel(props: RecorderPanelProps): JSX.Element {
  return (
    <details className="cl-recorder">
      <summary>Recorded events ({props.count})</summary>
      <button type="button" className="cl-btn" onClick={() => copy(props.json)}>
        Copy events JSON
      </button>
      <textarea className="cl-events" readOnly rows={8} value={props.json} />
    </details>
  );
}
