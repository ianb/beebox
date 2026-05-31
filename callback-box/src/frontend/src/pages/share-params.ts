/**
 * Helpers for parsing PWA share-target query params.
 *
 * Some apps put the shared URL in the `text` field and combine it with a
 * note, so we extract the URL and the surrounding text separately.
 */

/**
 * Parse a URL from share params. Some apps put the URL in the text field.
 */
export function extractUrl(params: URLSearchParams): string {
  const url = params.get("url");
  if (url) return url;

  const text = params.get("text") || "";
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch) return urlMatch[0];

  return "";
}

/**
 * Extract non-URL text from the text param (some apps combine note + URL).
 */
export function extractText(params: URLSearchParams): string {
  const text = params.get("text") || "";
  return text.replace(/https?:\/\/\S+/g, "").trim();
}
