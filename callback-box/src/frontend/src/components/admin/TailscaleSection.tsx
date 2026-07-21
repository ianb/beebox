/**
 * Tailscale section: instructions for reaching this box privately over a
 * tailnet. Informational only — `cb tailscale status/setup/stop` run on the
 * server host, not the browser, so this section points at those commands and
 * Tailscale's own docs rather than driving them live. The one dynamic bit: when
 * the page is viewed on a loopback address we fill in `--target` from the URL's
 * own port (see `useLocalTargetPort`).
 */

import { useEffect, useState } from "react";
import { ExternalLink } from "../ui/ExternalLink";

/** The dev router listens here (`bin/router.ts` ROUTER_PORT) and is never a
 *  valid Tailscale target (unauthenticated control routes), so we never suggest
 *  it even when the admin page is viewed on `localhost:3210`. */
const DEV_ROUTER_PORT = "3210";

/**
 * The loopback port to pre-fill into `cb tailscale setup --target`, or null.
 *
 * When the admin page is being viewed on a loopback host, the port in the
 * browser's own URL IS the loopback port serving this box — exactly the target
 * to expose. (In dev you can only reach `/admin` through a standalone
 * `cb serve`, since the router's login page 404s behind its prefix, so this
 * port is the serve port, not the router's.) Read in an effect so SSR and the
 * first client render agree (both null) and only the post-mount render fills it
 * in — no hydration mismatch. Null for SSR, non-loopback hosts, the dev router
 * port, and port-less URLs.
 */
function useLocalTargetPort(): string | null {
  const [port, setPort] = useState<string | null>(null);
  useEffect(() => {
    const { hostname, port: locPort } = window.location;
    const isLoopback =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
    if (isLoopback && locPort !== "" && locPort !== DEV_ROUTER_PORT) setPort(locPort);
  }, []);
  return port;
}

const CODE = "text-xs bg-warm-100 text-warm-800 px-1 py-0.5 rounded";

export function TailscaleSection() {
  const localPort = useLocalTargetPort();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold text-warm-800">Tailscale</h2>
        <span className="text-xs bg-warm-200 text-warm-600 px-2 py-0.5 rounded">System-wide</span>
      </div>
      <p className="text-sm text-warm-700 mb-4">
        Tailscale puts this box on a private network only your own devices can reach, so
        you can open it from your phone or laptop anywhere — on any Wi-Fi — without exposing
        anything to the public internet. It&rsquo;s a second lock <em>on top of</em> your
        login, not a replacement: being on the network gets you to the door, but you still
        sign in.
      </p>

      <h3 className="text-sm font-semibold text-warm-800 mb-2">Getting started</h3>
      <ol className="list-decimal list-inside text-sm text-warm-700 space-y-2 mb-4">
        <li>
          Install Tailscale on this machine and on your phone or laptop, and sign in to
          each.{" "}
          <ExternalLink href="https://tailscale.com/download">Download Tailscale</ExternalLink>
        </li>
        <li>
          On the machine running this box, run{" "}
          {localPort !== null ? (
            <>
              <code className={CODE}>cb tailscale setup --target {localPort}</code>{" "}
              (port {localPort}, detected from this page&rsquo;s address).
            </>
          ) : (
            <>
              <code className={CODE}>cb tailscale setup</code> (it auto-detects the port; pass{" "}
              <code className={CODE}>--target &lt;port&gt;</code> only for a non-standard setup).
            </>
          )}{" "}
          It checks what&rsquo;s already set up, walks you through each remaining step, and
          prints your private <code className={CODE}>https://…ts.net</code> address when
          it&rsquo;s ready.
        </li>
        <li>
          To let family members in, invite them to your tailnet.{" "}
          <ExternalLink href="https://tailscale.com/kb/1388">Sharing with family</ExternalLink>
        </li>
      </ol>

      <p className="text-sm text-warm-600">
        Run <code className={CODE}>cb tailscale status</code> any time to see where things
        stand, or <code className={CODE}>cb tailscale stop</code> to take the box back off
        the network.
      </p>
    </div>
  );
}
