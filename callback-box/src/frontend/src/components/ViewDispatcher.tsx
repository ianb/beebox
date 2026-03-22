/**
 * Dispatches a ViewTarget to the appropriate file viewer.
 *
 * Looks up the best viewer from the file viewer registry based on
 * the file path and optional explicit viewer name.
 */

import { type ViewTarget } from "../lib/view-url";
import { getFileViewer } from "../viewers/registry";
import "../viewers/index"; // ensure viewers are registered

type ViewMode = "page" | "chat" | "companion";

interface ViewDispatcherProps {
  target: ViewTarget;
  mode: ViewMode;
}

function ViewNotFound({ path }: { path: string }) {
  return (
    <div className="border border-warm-300 bg-warm-50 rounded-lg p-4">
      <p className="text-warm-700">No viewer found for: <code className="text-sm">{path}</code></p>
    </div>
  );
}

export function ViewDispatcher({ target, mode }: ViewDispatcherProps) {
  const viewer = getFileViewer(target.path, target.viewer);
  if (!viewer) {
    return <ViewNotFound path={target.path} />;
  }

  return <viewer.Component filePath={target.path} params={target.params} mode={mode} />;
}
