export function imageUrlKey(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.href).href;
  } catch (_error) {
    return url;
  }
}
