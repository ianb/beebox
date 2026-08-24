/**
 * Tailscale section: instructions for reaching this box privately over a
 * tailnet. Informational only — `cb tailscale status/setup/stop` run on the
 * server host, not the browser, so this section points at those commands and
 * Tailscale's own docs rather than driving them live. Two dynamic bits: when
 * the page is viewed on a loopback address we fill in `--target` from the
 * URL's own port (see `useLocalTargetPort`), and — also loopback-only — we
 * query the backend for whether the box is currently exposed over Tailscale
 * and, if so, link straight to it (`admin.tailscaleBaseUrl`).
 */

import { useEffect, useState } from "react";
import { getApiBase } from "../../api";
import { trpc } from "../../lib/trpc";
import { ExternalLink } from "../ui/ExternalLink";

/** The dev router listens here (`bin/router.ts` ROUTER_PORT). We don't pre-fill
 *  it as a *per-box* `--target`: viewing `/admin` on `localhost:3210` means
 *  you're on the router, and exposing the *whole* authenticated router is the
 *  explicit dev-machine path (the note at the bottom of this section), not a
 *  single-box setup. */
const DEV_ROUTER_PORT = "3210";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * The loopback port to pre-fill into `cb tailscale setup --target`, or null.
 *
 * When the admin page is viewed on a loopback host, the port in the browser's
 * own URL IS the loopback port serving this box — exactly the per-box target to
 * expose. The dev router port (3210) is excluded: on it you'd expose the whole
 * router (the bottom note), not one box. Read in an effect so SSR and the first
 * client render agree (both null) and only the post-mount render fills it in —
 * no hydration mismatch. Null for SSR, non-loopback hosts, the dev router port,
 * and port-less URLs.
 */
function useLocalTargetPort(): string | null {
  const [port, setPort] = useState<string | null>(null);
  useEffect(() => {
    const { hostname, port: locPort } = window.location;
    if (isLoopbackHostname(hostname) && locPort !== "" && locPort !== DEV_ROUTER_PORT) setPort(locPort);
  }, []);
  return port;
}

/**
 * Whether the admin page itself is being viewed on a loopback host — gates
 * the `tailscaleBaseUrl` query (querying from a deployed/non-local origin
 * would be asking a remote box about ITS OWN loopback tailscale exposure,
 * which is a legitimate query but not what this section is for). Same
 * effect-based SSR-safety shape as `useLocalTargetPort`: false until the
 * post-mount check runs.
 */
function useIsLoopback(): boolean {
  const [loopback, setLoopback] = useState(false);
  useEffect(() => {
    if (isLoopbackHostname(window.location.hostname)) setLoopback(true);
  }, []);
  return loopback;
}

/**
 * This box's own path prefix (e.g. "/main/test1/" or "/"), derived from the
 * API base by dropping its trailing "/api" segment — the same prefix this
 * page is itself served under. Appended to the Tailscale base URL, it links
 * to this exact box rather than just the tailnet host root.
 */
function boxPathPrefix(): string {
  const apiBase = getApiBase(); // e.g. "/main/test1/api" or "/api"
  const stripped = apiBase.endsWith("/api") ? apiBase.slice(0, -"/api".length) : apiBase;
  return stripped === "" ? "/" : `${stripped}/`;
}

const CODE = "text-xs bg-warm-100 text-warm-800 px-1 py-0.5 rounded";

export function TailscaleSection() {
  const localPort = useLocalTargetPort();
  const isLoopback = useIsLoopback();
  const tailscaleUrlQuery = trpc.admin.tailscaleBaseUrl.useQuery(undefined, { enabled: isLoopback });
  const tailscaleBoxUrl =
    tailscaleUrlQuery.data?.baseUrl != null ? `${tailscaleUrlQuery.data.baseUrl}${boxPathPrefix()}` : null;

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

      {tailscaleBoxUrl !== null ? (
        <p className="text-sm text-warm-700 mb-4">
          This box over Tailscale: <ExternalLink id="cb-admin-tailscale-box-url" href={tailscaleBoxUrl}>{tailscaleBoxUrl}</ExternalLink>
        </p>
      ) : null}

      <h3 className="text-sm font-semibold text-warm-800 mb-2">Getting started</h3>
      <ol className="list-decimal list-inside text-sm text-warm-700 space-y-2 mb-4">
        <li>
          Install Tailscale on this machine and on your phone or laptop, and sign in to
          each.{" "}
          <ExternalLink id="cb-admin-tailscale-download" href="https://tailscale.com/download">Download Tailscale</ExternalLink>
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
          <ExternalLink id="cb-admin-tailscale-sharing" href="https://tailscale.com/kb/1388">Sharing with family</ExternalLink>
        </li>
      </ol>

      <p className="text-sm text-warm-600">
        Run <code className={CODE}>cb tailscale status</code> any time to see where things
        stand, or <code className={CODE}>cb tailscale stop</code> to take the box back off
        the network.
      </p>

      <p className="text-sm text-warm-600 mt-4">
        On a dev machine, point this at the shared dev router instead of a single box —{" "}
        <code className={CODE}>cb tailscale setup --target &lt;router-port&gt;</code> (e.g.{" "}
        <code className={CODE}>3210</code>) exposes the whole authenticated router, every
        worktree and box, over the tailnet. One login gets you all of it, remotely.
      </p>
    </div>
  );
}
