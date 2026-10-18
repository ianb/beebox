// # Cloudflare publishing save feedback
//
// The save result stays beside its submit button, where it remains visible after
// the long token setup instructions. Failures are announced as alerts; successful
// saves are announced as status, including when refreshing the list fails.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionEditor } from "../../../../src/components/admin/CloudflarePublishConnectionsSection/view.js";

globalThis.React = React;
function editor(saveError: string | null, saveStatus: string | null): string {
  return renderToStaticMarkup(React.createElement(ConnectionEditor, {
    name: "studio",
    accountId: "0123456789abcdef0123456789abcdef",
    apiToken: "",
    rotateTarget: null,
    pending: false,
    saveError,
    saveStatus,
    setName: () => {},
    setAccountId: () => {},
    setApiToken: () => {},
    onSubmit: () => {},
    onCancelRotation: () => {},
  }));
}
const failed = editor("Cloudflare did not verify an active token.", null);
const succeeded = editor(null, "Saved “studio”, but the saved connections list could not be refreshed. Reload the page to check it.");

void test("line 33", async (t) => {
  // doctest:L34
  await t.checkText(failed.includes('role="alert"') && failed.indexOf('id="bbx-admin-cf-publish-save"') < failed.indexOf("Cloudflare did not verify"), "true");
});

void test("line 38", async (t) => {
  // doctest:L39
  await t.checkText(succeeded.includes('role="status"') && succeeded.indexOf('id="bbx-admin-cf-publish-save"') < succeeded.indexOf("could not be refreshed"), "true");
});
