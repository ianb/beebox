// # Shared publication host status
//
// Admin shows whether the box host is ready or still needs the owner to retry the
// reserved attachment. This presentational component can be exercised without
// signing in or changing the test box's Cloudflare settings.

import { test } from "tap";
import "agent-doctest/tap";
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
  // doctest:L23
  await t.checkText(
    pendingHost.includes("https://publish.example.org/")
      && pendingHost.includes("state: pending")
      && pendingHost.includes("Retry to finish attaching"),
    "true",
  );

  // doctest:L28
  await t.checkText(
    attachedHost.includes("state: attached")
      && attachedHost.includes("New publications can request paths beneath it")
      && attachedHost.includes("check and repair action"),
    "true",
  );
});
