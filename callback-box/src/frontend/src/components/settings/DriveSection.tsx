/**
 * Google Drive section: read-only for now.
 *
 * A Drive mount is a card — `.gdoc.card`/`.gsheet.card` for a synced file,
 * `.gfolder.card` for a mirrored folder, `.glink.card` for a pointer — written
 * by `cb drive add` / `mount` / `link`. The only thing left in connector config
 * is the legacy `folders` array, which the next sync converts into mount cards
 * and removes; it is listed here while it still exists.
 */

import { trpc } from "../../lib/trpc";
import { GoogleConnectLink } from "./GoogleConnectLink";

export function DriveSection() {
  const configQuery = trpc.drive.config.useQuery();
  const error = configQuery.error?.message ?? null;
  const folders = configQuery.data?.folders ?? [];

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">
          Google Drive
        </h2>
        <div className="p-3 bg-warning-50 border border-warning-100 rounded text-sm text-warning-dark">
          {error}
        </div>
        <GoogleConnectLink id="cb-settings-drive-connect-google" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">
        Google Drive
      </h2>
      <p className="text-sm text-warm-700 mb-4">
        Mount a Drive folder with{" "}
        <code className="text-xs bg-warm-100 px-1 rounded">cb drive mount &lt;url&gt; &lt;dir&gt;</code>,
        a single Doc or Sheet with{" "}
        <code className="text-xs bg-warm-100 px-1 rounded">cb drive add &lt;url&gt; &lt;path&gt;</code>,
        or keep a pointer to anything with{" "}
        <code className="text-xs bg-warm-100 px-1 rounded">cb drive link &lt;url&gt; &lt;path&gt;</code>.
      </p>

      {folders.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium text-warm-800 mb-2">
            Folder mounts awaiting conversion
          </h3>
          <div className="space-y-1">
            {folders.map((folder) => (
              <div
                key={folder.driveFolderId}
                className="flex items-center gap-3 px-3 py-2 rounded bg-warm-50 text-sm"
              >
                <span className="text-warm-600">{folder.localPath}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-warm-500 mt-2">
            The next Drive sync turns each of these into a folder card in that directory.
          </p>
        </div>
      ) : null}
    </div>
  );
}
