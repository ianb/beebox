interface HistoryBlobUrlParams {
  apiBase: string;
  hash: string;
  filePath: string;
}

/** Build a history blob URL without allowing path characters to alter the URL. */
export function buildHistoryBlobUrl(params: HistoryBlobUrlParams): string {
  const { apiBase, hash, filePath } = params;
  const encodedPath = filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${apiBase}/history/blob/${hash}/${encodedPath}`;
}
