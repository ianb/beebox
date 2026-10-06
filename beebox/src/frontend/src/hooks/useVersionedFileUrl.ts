import { useQuery } from "@tanstack/react-query";

/** Add a file version to a URL used by a browser/plugin viewer. */
export function versionedFileUrl(url: string, version: string | null | undefined): string {
  return version === undefined || version === null ? url : `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

export type VersionedFileUrl =
  | { state: "loading" }
  /** The server answered 404: the file is gone, so there is nothing to embed. */
  | { state: "missing" }
  | { state: "ready"; url: string };

/**
 * Resolve a raw file URL only after a fresh HEAD has supplied its ETag.
 * PDF's built-in viewer keys its own cache by URL, so the version belongs in
 * the URL and the object must not briefly mount at the unversioned URL.
 * A missing file is reported as such; embedding it anyway makes the browser
 * show its "can't display" fallback, which reads as a viewer problem.
 */
export function useVersionedFileUrl(url: string, { path, enabled }: { path: string; enabled?: boolean }): VersionedFileUrl {
  const isEnabled = enabled !== false;
  const query = useQuery({
    queryKey: ["pdf-file-etag", path],
    enabled: isEnabled,
    queryFn: async () => {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (response.status === 404) return { missing: true as const };
      return { missing: false as const, etag: response.ok ? response.headers.get("etag") : null };
    },
    staleTime: 0,
    refetchOnMount: "always",
    // File-change updates are a separate decision; focus/reconnect should not
    // silently turn this remounting behavior into a live-update policy.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!isEnabled || query.isFetching) return { state: "loading" };
  if (query.data?.missing === true) return { state: "missing" };
  return { state: "ready", url: versionedFileUrl(url, query.data?.etag) };
}
