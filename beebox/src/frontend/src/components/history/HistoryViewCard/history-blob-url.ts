import { encodePathForUrl } from "../../../lib/view-url";

interface HistoryBlobUrlParams {
  apiBase: string;
  hash: string;
  filePath: string;
}

/** Build a history blob URL without allowing path characters to alter the URL. */
export function buildHistoryBlobUrl(params: HistoryBlobUrlParams): string {
  const { apiBase, hash, filePath } = params;
  return `${apiBase}/history/blob/${hash}/${encodePathForUrl(filePath)}`;
}
