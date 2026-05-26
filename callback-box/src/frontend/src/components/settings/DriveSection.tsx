/**
 * Google Drive section: lists mounted folders and available spreadsheets.
 * Mounting itself is done via CLI (`cb drive add`); this view is read-only.
 */

import { trpc } from "../../lib/trpc";
import { GoogleConnectLink } from "./GoogleConnectLink";

export function DriveSection() {
  const configQuery = trpc.drive.config.useQuery();
  const availableQuery = trpc.drive.available.useQuery(undefined, { retry: false });
  const error = availableQuery.error?.message ?? configQuery.error?.message ?? null;
  const config = configQuery.data;
  const available = availableQuery.data;

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">
          Google Drive
        </h2>
        <div className="p-3 bg-warning-50 border border-warning-100 rounded text-sm text-warning-dark">
          {error}
        </div>
        <GoogleConnectLink />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">
        Google Drive
      </h2>
      <p className="text-sm text-warm-700 mb-4">
        Spreadsheets are synced as CSV files. Use{" "}
        <code className="text-xs bg-warm-100 px-1 rounded">cb drive add &lt;url&gt; &lt;path&gt;</code>{" "}
        to mount a spreadsheet.
      </p>

      {config?.folders && config.folders.length > 0 ? (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-warm-800 mb-2">Folder mounts</h3>
          <div className="space-y-1">
            {config.folders.map((f) => (
              <div key={f.driveFolderId} className="flex items-center gap-3 px-3 py-2 rounded bg-warm-50 text-sm">
                <span className="text-warm-600">{f.localPath}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {available && available.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium text-warm-800 mb-2">Available spreadsheets</h3>
          <div className="space-y-1 max-h-48 overflow-auto">
            {available.map((file) => (
              <div key={file.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-warm-50 text-sm">
                <span className="flex-1 min-w-0 text-warm-900 truncate">{file.name}</span>
                <span className="text-xs text-warm-500 flex-shrink-0">
                  {new Date(file.modifiedTime).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-warm-500 mt-2">
            Use the CLI to mount: <code className="bg-warm-100 px-1 rounded">cb drive add &lt;url&gt; store/drive/name</code>
          </p>
        </div>
      ) : !availableQuery.isLoading ? (
        <p className="text-sm text-warm-600">No spreadsheets found in your Drive.</p>
      ) : (
        <p className="text-sm text-warm-600">Loading spreadsheets...</p>
      )}
    </div>
  );
}
