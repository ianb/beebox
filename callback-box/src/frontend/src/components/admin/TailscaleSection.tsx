/**
 * Tailscale section: static instructions for reaching this box privately over a
 * tailnet. Informational only — `cb tailscale status/setup/stop` run on the
 * server host, not the browser, so this section points at those commands and
 * Tailscale's own docs rather than driving them live.
 */

import { ExternalLink } from "../ui/ExternalLink";

export function TailscaleSection() {
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
          <code className="text-xs bg-warm-100 text-warm-800 px-1 py-0.5 rounded">cb tailscale setup --target &lt;port&gt;</code>.
          It checks what&rsquo;s already set up, walks you through each remaining step, and
          prints your private <code className="text-xs bg-warm-100 text-warm-800 px-1 py-0.5 rounded">https://…ts.net</code>{" "}
          address when it&rsquo;s ready.
        </li>
        <li>
          To let family members in, invite them to your tailnet.{" "}
          <ExternalLink href="https://tailscale.com/kb/1388">Sharing with family</ExternalLink>
        </li>
      </ol>

      <p className="text-sm text-warm-600">
        Run{" "}
        <code className="text-xs bg-warm-100 text-warm-800 px-1 py-0.5 rounded">cb tailscale status --target &lt;port&gt;</code>{" "}
        any time to see where things stand, or{" "}
        <code className="text-xs bg-warm-100 text-warm-800 px-1 py-0.5 rounded">cb tailscale stop</code>{" "}
        to take the box back off the network.
      </p>
    </div>
  );
}
