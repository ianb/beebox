// # Shared publication host status
//
// Admin shows whether the box host is ready or still needs the owner to retry the
// reserved attachment. This presentational component can be exercised without
// signing in or changing the test box's Cloudflare settings.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedPublicationHostSummary } from "../../../../src/components/admin/CloudflarePublishConnectionsSection/SharedPublicationHost.js";

globalThis.React = React;
function summary(status: "pending" | "attached") {
  return renderToStaticMarkup(React.createElement(SharedPublicationHostSummary, {
    host: { hostname: "publish.example.org", connectionName: "primary", status },
  }));
}
const pendingHost = summary("pending");
const attachedHost = summary("attached");

void test("line 22", async (t) => {
  t.check(pendingHost, "<div class=\"flex flex-col gap-1\"><span class=\"text-warm-900 text-sm\">Destination: <span class=\"text-warm-900 text-base font-mono break-all\">https://publish.example.org/</span></span><span class=\"text-warm-900 text-sm\">Connection: primary · state: pending</span><p class=\"text-sm text-warm-700\">Setup is incomplete. Retry to finish attaching this reserved hostname; the hostname and connection cannot be changed here.</p></div>");
  t.check(attachedHost, "<div class=\"flex flex-col gap-1\"><span class=\"text-warm-900 text-sm\">Destination: <span class=\"text-warm-900 text-base font-mono break-all\">https://publish.example.org/</span></span><span class=\"text-warm-900 text-sm\">Connection: primary · state: attached</span><span class=\"text-warm-700 text-sm\">The hostname is attached. New publications can request paths beneath it. Use the check and repair action if a Worker update or route needs recovery.</span></div>");
});
