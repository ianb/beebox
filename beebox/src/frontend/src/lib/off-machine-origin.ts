/**
 * Whether a phone could reach this page's origin: a loopback origin
 * (`localhost`, `127.x.x.x`, `::1`) names only the machine the browser runs
 * on. Any other origin is one this browser reached over a network, the best
 * sign the frontend has that another device can reach it too. The printed
 * card's QR code depends on it.
 */
export function isOffMachineOrigin(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "0.0.0.0" || host === "") return false;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return false;
  // An IPv4-mapped loopback (`[::ffff:127.0.0.1]`) parses to `::ffff:7f..:..`.
  if (/^::ffff:(?:7f[\da-f]{2}:[\da-f]{1,4}|127(?:\.\d{1,3}){3})$/.test(host)) return false;
  return url.protocol === "http:" || url.protocol === "https:";
}
