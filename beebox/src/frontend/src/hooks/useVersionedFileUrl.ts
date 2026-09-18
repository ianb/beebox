import { useQuery } from "@tanstack/react-query";

/** Add a file version to a URL used by a browser/plugin viewer. */
export function versionedFileUrl(url: string, version: string | null | undefined): string {
  return version === undefined || version === null ? url : `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

/**
 * Resolve a raw file URL only after a fresh HEAD has supplied its ETag.
 * PDF's built-in viewer keys its own cache by URL, so the version belongs in
 * the URL and the object must not briefly mount at the unversioned URL.
 */
export function useVersionedFileUrl(url: string, { path, enabled }: { path: string; enabled?: boolean }): string | null {
  const isEnabled = enabled !== false;
  const query = useQuery({
    queryKey: ["pdf-file-etag", path],
    enabled: isEnabled,
    queryFn: async () => {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      return response.ok ? response.headers.get("etag") : null;
    },
    staleTime: 0,
    refetchOnMount: "always",
    // File-change updates are a separate decision; focus/reconnect should not
    // silently turn this remounting behavior into a live-update policy.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!isEnabled) return null;
  if (query.isFetching) return null;
  return versionedFileUrl(url, query.data);
}
